import { Inject, Injectable } from '@nestjs/common';
import type { DatosEntrega, NuevoOfferItemReactiva, Offer } from '@repon/types';
import {
  CATALOG_QUERY_PORT,
  type CatalogQueryPort,
} from '../../catalogo/contracts/catalog-query.port';
import { TRANSACTION_MANAGER, type TransactionManager } from '../../../shared/database/transaction';
import {
  EVENT_PUBLISHER,
  type EventPublisher,
} from '../../../shared/event-bus/event-publisher.port';
import {
  NOTIFICATION_PORT,
  type NotificationPort,
} from '../../../shared/notifications/notification.port';
import { crearOfertaReactiva } from '../domain/offer.entity';
import {
  OfertaInvalidaError,
  OportunidadCerradaError,
  SolicitudNoElegibleError,
} from '../domain/oferta.errors';
import { OfertaEnviada } from '../events/oferta-enviada.event';
import type { OfertaEnviadaPayload } from '../events/oferta-enviada.payload';
import {
  OFFER_OPPORTUNITY_REPOSITORY,
  type OfferOpportunityRepository,
} from '../ports-out/offer-opportunity-repository.port';
import { OFFER_REPOSITORY, type OfferRepository } from '../ports-out/offer-repository.port';

/**
 * `ofertas/SPEC.md`'s `enviarOferta(companyId, refillRequestId, items,
 * entrega): Promise<Offer>` — design.md Diagrama 2, the PR design.md itself
 * names "el PR que más merece review dedicada": cierra R2 (404 cross-tenant/
 * no-elegible, nunca 403) y R3 (el puerto de catálogo resuelve ANTES de que
 * la transacción se abra — la garantía de orden de C2, probada por D-C).
 *
 * ## Constructor: 6 tokens — el ÚNICO caso de uso de este dominio que
 * inyecta A LA VEZ `TRANSACTION_MANAGER` y `CATALOG_QUERY_PORT` (design.md
 * D13: "el primer caso de uso del repo que hace las dos cosas" — la
 * garantía de orden de C2 deja de ser estructural acá y pasa a ser de
 * orden de ejecución, enforceada solo por el test D-C de abajo, tasks.md
 * 5a.5, no por la ausencia de un token como en
 * `ListarSolicitudesElegiblesUseCase`/`ObtenerBandejaUseCase`).
 *
 * ## Flujo (design.md Diagrama 2 — los pasos 1-2, AuthGuard/RolesGuard +
 * la llamada del controller, son trabajo de PR5b; este caso de uso arranca
 * en el paso 3, y ya recibe `companyId` como parámetro plano, nunca el
 * `actor` completo)
 *
 * 3. `findElegible(refillRequestId, companyId)` — SIN `tx`: no hay
 *    transacción abierta todavía.
 * 4. `null` -> `SolicitudNoElegibleError` (404). El repositorio (PR3b) ya
 *    no distingue "la solicitud no existe" de "existe pero esta empresa no
 *    es elegible" — las dos causas colapsan en `null`, así que esta es la
 *    ÚNICA rama, y el error resultante es byte-idéntico por construcción
 *    (D11 — un 403 confirmaría existencia a una empresa que nunca fue
 *    elegible).
 * 5. `cerradaAt !== null` -> `OportunidadCerradaError` (409). Chequeado
 *    DESPUÉS del paso 4, a propósito: una empresa no elegible sobre una
 *    solicitud cerrada nunca llega acá (ya lanzó 404 antes) — el 409 solo
 *    es alcanzable por una empresa que SI es/fue elegible (Q4).
 * 6. Todo `item.refillItemId` DEBE resolver a una entrada de
 *    `oportunidad.items` — validado contra la proyección, jamás confiado
 *    del cliente. Un id ajeno -> `OfertaInvalidaError` (400), rechazado
 *    antes de cualquier escritura.
 * 7. `buscarCoincidencias(oportunidad.items, companyId)` — ***FUERA DE
 *    TODA TRANSACCIÓN*** (C2/D13/R3, el test D-C de abajo). `oportunidad.items`
 *    ya es `RefillItem[]` (el `findElegible` de PR3b lo mapea 1:1), así
 *    que pasa directo, sin una línea de adaptación. Un
 *    `CatalogQueryUnavailableError` (C8) NO se captura acá: propaga sin
 *    catch — mapearlo a HTTP 503 es trabajo de
 *    `ofertas-exception.filter.ts` (PR5b).
 * 8. Las 2 reglas de D-G.2, por ítem: (a) **regla dura** — todo ítem debe
 *    tener coincidencia viva en el resultado del puerto, correlacionada
 *    por `catalogProductId` cuando el `RefillItem` subyacente lo trae, o
 *    por `categoria` en caso contrario (las mismas 2 ramas que usa la
 *    semántica de matching C7 del propio puerto) — sin coincidencia ->
 *    `OfertaInvalidaError` (400); (b) **techo de precio** — un ítem no-alt
 *    cotizado por sobre el `precioMaximo` de su coincidencia ->
 *    `OfertaInvalidaError` (400). Un ítem `isAlt` NUNCA se chequea contra
 *    `precioMaximo` — riesgo residual documentado (design.md D-G.2, mismo
 *    doc comment de `precioPorUnidad` en PR2): la presentación difiere de
 *    la línea de catálogo, así que compararlas es comparar peras con
 *    manzanas. NO "arreglar" esto agregando un chequeo — es una decisión
 *    de diseño nombrada, no un olvido.
 * 9. `crearOfertaReactiva(...)` (Phase 2) construye la `Offer` — `total` se
 *    calcula DENTRO de la factory (`Σ(item.precio) + costoDespacho`, el
 *    `total()` de PR2), así que construir la entidad acá ya satisface "el
 *    total se calcula en el dominio, antes de abrir la transacción" — no
 *    hace falta una segunda llamada explícita a `total()`.
 * 10. `runInTransaction` (D13) envuelve exactamente UN
 *     `offerRepository.save(offer, tx)`. `offer.userId` es
 *     `oportunidad.userId` — seteado por el propio parámetro `userId` de
 *     `crearOfertaReactiva`, JAMÁS un join fresco contra `refill_requests`
 *     (no existe camino síncrono, honrando la D7 de `refill-matching`).
 * 11. DESPUÉS del commit: `eventPublisher.publish(new OfertaEnviada(...))`.
 * 12. `notificationPort.sendPush(oportunidad.userId, mensaje)` —
 *     best-effort, en este mismo cuerpo, nunca vía un listener intermedio
 *     (D17). `sendPush` nunca lanza por su propio contrato
 *     (`NotificationPort`'s own doc comment).
 */
@Injectable()
export class EnviarOfertaUseCase {
  constructor(
    @Inject(OFFER_OPPORTUNITY_REPOSITORY)
    private readonly opportunityRepository: OfferOpportunityRepository,
    @Inject(OFFER_REPOSITORY) private readonly offerRepository: OfferRepository,
    @Inject(CATALOG_QUERY_PORT) private readonly catalogQueryPort: CatalogQueryPort,
    @Inject(TRANSACTION_MANAGER) private readonly transactionManager: TransactionManager,
    @Inject(EVENT_PUBLISHER) private readonly eventPublisher: EventPublisher,
    @Inject(NOTIFICATION_PORT) private readonly notificationPort: NotificationPort,
  ) {}

  async execute(
    companyId: string,
    refillRequestId: string,
    items: readonly NuevoOfferItemReactiva[],
    entrega: DatosEntrega,
  ): Promise<Offer> {
    // (3) sin tx: no hay transaccion abierta todavia.
    const oportunidad = await this.opportunityRepository.findElegible(refillRequestId, companyId);

    // (4) no existe Y no elegible dan EL MISMO error, byte a byte -- el
    // repositorio ya colapsa ambas causas en `null` (D11).
    if (oportunidad === null) {
      throw new SolicitudNoElegibleError(refillRequestId);
    }

    // (5) DESPUES de (4), a proposito (Q4).
    if (oportunidad.cerradaAt !== null) {
      throw new OportunidadCerradaError(refillRequestId);
    }

    // (6) contra la proyeccion, jamas confiado del cliente. Tambien
    // rechaza un refillItemId repetido dentro de la misma oferta -- sin
    // este chequeo, dos lineas para el mismo item pasarian el resto de
    // las validaciones por separado y `total()` sumaria ambas, duplicando
    // el total sin que ninguna otra capa lo detecte (hallazgo de
    // code-review sobre PR5a).
    const refillItemsById = new Map(oportunidad.items.map((item) => [item.id, item]));
    const refillItemIdsVistos = new Set<string>();
    for (const item of items) {
      if (refillItemIdsVistos.has(item.refillItemId)) {
        throw new OfertaInvalidaError(
          `El item ${item.refillItemId} aparece más de una vez en la oferta.`,
        );
      }
      refillItemIdsVistos.add(item.refillItemId);
      if (!refillItemsById.has(item.refillItemId)) {
        throw new OfertaInvalidaError(
          `El item ${item.refillItemId} no pertenece a la solicitud ${refillRequestId}.`,
        );
      }
    }

    // (7) ***FUERA DE TODA TRANSACCION*** -- ver el test D-C (tasks.md
    // 5a.5). NO se captura CatalogQueryUnavailableError: propaga sin catch
    // (C8).
    const matches = await this.catalogQueryPort.buscarCoincidencias(oportunidad.items, companyId);

    // (8) regla dura + techo de precio, solo para items no-alt (D-G.2).
    for (const item of items) {
      const refillItem = refillItemsById.get(item.refillItemId)!;
      const match = matches.find((candidate) =>
        refillItem.catalogProductId
          ? candidate.catalogProductId === refillItem.catalogProductId
          : candidate.categoria === refillItem.categoria,
      );

      if (match === undefined) {
        throw new OfertaInvalidaError(
          `El item ${item.refillItemId} no tiene coincidencia vigente en el catalogo de esta empresa.`,
        );
      }
      if (!item.isAlt && item.precio > match.precioMaximo) {
        throw new OfertaInvalidaError(
          `El precio (${item.precio}) del item ${item.refillItemId} supera el precioMaximo ` +
            `(${match.precioMaximo}) del catalogo. El techo no aplica a items isAlt ` +
            '(design.md D-G.2, riesgo residual).',
        );
      }
    }

    // (9) `total` se calcula DENTRO de la factory, antes de abrir la
    // transaccion -- construir la entidad aca ya satisface el orden de
    // D13.
    const offer = crearOfertaReactiva(
      companyId,
      refillRequestId,
      items,
      entrega,
      oportunidad.userId,
    );

    // (10)
    await this.transactionManager.runInTransaction(async (tx) => {
      await this.offerRepository.save(offer, tx);
    });
    // ---- COMMIT ----

    // (11)
    const payload: OfertaEnviadaPayload = {
      offerId: offer.id,
      kind: offer.kind,
      companyId,
      userId: oportunidad.userId,
      refillRequestId,
      total: offer.total,
      tiempoEntregaHoras: entrega.tiempoEntregaHoras,
    };
    await this.eventPublisher.publish(new OfertaEnviada(payload));

    // (12) best-effort (D17) -- sendPush nunca lanza por contrato.
    await this.notificationPort.sendPush(
      oportunidad.userId,
      'Recibiste una nueva oferta por tu solicitud de refill.',
    );

    return offer;
  }
}
