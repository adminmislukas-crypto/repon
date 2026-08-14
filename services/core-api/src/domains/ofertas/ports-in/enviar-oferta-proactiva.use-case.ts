import { Inject, Injectable } from '@nestjs/common';
import type { DatosEntrega, NuevoOfferItemProactiva, Offer } from '@repon/types';
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
import { crearOfertaProactiva } from '../domain/offer.entity';
import { DestinatarioNoElegibleError, ItemsNoDisponiblesError } from '../domain/oferta.errors';
import { OfertaEnviada } from '../events/oferta-enviada.event';
import type { OfertaEnviadaPayload } from '../events/oferta-enviada.payload';
import {
  OFFER_OPPORTUNITY_REPOSITORY,
  type OfferOpportunityRepository,
} from '../ports-out/offer-opportunity-repository.port';
import { OFFER_REPOSITORY, type OfferRepository } from '../ports-out/offer-repository.port';

/**
 * `ofertas/SPEC.md`'s `enviarOfertaProactiva(companyId, userId, items,
 * entrega, mensaje?): Promise<Offer>` — design.md Diagrama 2's closing note
 * (línea 662): "misma forma" que `EnviarOfertaUseCase` (Phase 5a), con 3
 * diferencias:
 *
 * (a) el paso 3 es `existeRelacion(companyId, userId)` (D10), no
 *     `findElegible` — no hay `refillRequestId` que buscar. Negativo:
 *     `DestinatarioNoElegibleError` → 404, mismo criterio 404-nunca-403 que
 *     `SolicitudNoElegibleError` (D11: un `userId` sin relación previa es
 *     indistinguible de un `userId` que no existe).
 * (b) el paso 7 es `obtenerItemsDeProveedor(companyId, ids)` (D-B), no
 *     `buscarCoincidencias`, y el paso 8 compara CARDINALIDADES —
 *     `matches.length !== ids.length` — nunca una correlación item-a-item
 *     por `catalogProductId`/`categoria`. Un solo id ajeno, inexistente, no
 *     disponible o de una empresa oculta (C9, descartado en silencio por el
 *     puerto) ya rechaza la solicitud COMPLETA con `ItemsNoDisponiblesError`
 *     → 400 — jamás una oferta más chica que la pedida.
 * (c) no hay oportunidad que consultar ni items de solicitud que validar
 *     contra una proyección: `providerCatalogItemId` es el único id que
 *     importa, y su pertenencia a la empresa que oferta la prueba el propio
 *     resultado del puerto (C9 vive en el `WHERE`, no en código de
 *     `ofertas`). `refillRequestId` viaja `null` en el evento publicado
 *     (D6/D18-3) — el negativo obligatorio sobre el que rama el
 *     `OfertaEnviadaListener` de `refill-matching` (Phase 8a): una oferta
 *     proactiva no tiene solicitud que transicionar.
 *
 * Constructor: mismos 6 tokens que `EnviarOfertaUseCase` — el único otro
 * caso de uso del dominio que inyecta A LA VEZ `TRANSACTION_MANAGER` y
 * `CATALOG_QUERY_PORT` (design.md D13/R3: la garantía de orden de C2 es de
 * ejecución acá también, enforceada por el test de tasks.md 6b.3, no por la
 * ausencia de un token).
 *
 * ## Flujo (arranca en el paso 3, como `EnviarOfertaUseCase` — los pasos
 * 1-2, AuthGuard/RolesGuard + la llamada del controller, son trabajo de la
 * parte HTTP de esta misma PR)
 *
 * 3. `existeRelacion(companyId, userId)` — SIN `tx`: no hay transacción
 *    abierta todavía. `false` → `DestinatarioNoElegibleError` (404).
 * 7. `obtenerItemsDeProveedor(companyId, ids)` — ***FUERA DE TODA
 *    TRANSACCIÓN*** (C2/D13/R3, el test de tasks.md 6b.3). `ids` son los
 *    `providerCatalogItemId` del cliente, JAMÁS `refillItemId`s (no existe
 *    solicitud). Un `CatalogQueryUnavailableError` (C8, heredado por D-B
 *    término a término) NO se captura acá: propaga sin catch — mapearlo a
 *    HTTP 503 es trabajo de `ofertas-exception.filter.ts`.
 * 8. `matches.length !== ids.length` ⇒ `ItemsNoDisponiblesError` (400),
 *    rechazado ANTES de cualquier escritura. Esta única comparación de
 *    cardinalidad cubre las cuatro causas de descarte del puerto (id
 *    ajeno, inexistente, no disponible, empresa oculta — design.md D-B) y
 *    también un id duplicado dentro del mismo `items[]`: `pc.id IN (ids)`
 *    no repite filas por un valor repetido en la lista, así que un
 *    duplicado reduce `matches.length` por construcción, sin necesitar un
 *    chequeo explícito propio (a diferencia de `EnviarOfertaUseCase`, que
 *    SÍ necesita rechazar un `refillItemId` repetido a mano porque su
 *    matching es por correlación, no por cardinalidad de un `IN`).
 * 9. `crearOfertaProactiva(...)` (Phase 2) construye la `Offer` — `total`
 *    se calcula DENTRO de la factory, así que construir la entidad acá ya
 *    satisface "el total se calcula en el dominio, antes de abrir la
 *    transacción".
 * 10. `runInTransaction` (D13) envuelve exactamente UN
 *     `offerRepository.save(offer, tx)`.
 * 11. DESPUÉS del commit: `eventPublisher.publish(new OfertaEnviada(...))`
 *     con `refillRequestId: null` — diferencia (c) de arriba.
 * 12. `notificationPort.sendPush(userId, mensaje)` — best-effort, en este
 *     mismo cuerpo, nunca vía un listener intermedio (D17).
 */
@Injectable()
export class EnviarOfertaProactivaUseCase {
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
    userId: string,
    items: readonly NuevoOfferItemProactiva[],
    entrega: DatosEntrega,
    mensaje?: string,
  ): Promise<Offer> {
    // (3) D10 — sin tx: no hay transaccion abierta todavia. `false` es
    // indistinguible de "ese userId no existe" (D11, mismo criterio
    // 404-nunca-403 que SolicitudNoElegibleError).
    const elegible = await this.opportunityRepository.existeRelacion(companyId, userId);
    if (!elegible) {
      throw new DestinatarioNoElegibleError(userId);
    }

    // (7) ***FUERA DE TODA TRANSACCION*** -- ver el test de tasks.md 6b.3.
    // NO se captura CatalogQueryUnavailableError: propaga sin catch (C8,
    // heredado por D-B).
    const ids = items.map((item) => item.providerCatalogItemId);
    const matches = await this.catalogQueryPort.obtenerItemsDeProveedor(companyId, ids);

    // (8) D-B: comparacion de CARDINALIDAD, nunca correlacion item a item.
    // Un solo id ajeno, inexistente, no disponible o de empresa oculta ya
    // rechaza la solicitud COMPLETA -- jamas una oferta mas chica.
    if (matches.length !== ids.length) {
      throw new ItemsNoDisponiblesError(
        `${ids.length - matches.length} de ${ids.length} item(s) no estan disponibles en el ` +
          'catalogo de esta empresa.',
      );
    }

    // (9) `total` se calcula DENTRO de la factory, antes de abrir la
    // transaccion -- construir la entidad aca ya satisface el orden de
    // D13.
    const offer = crearOfertaProactiva(companyId, userId, items, entrega, mensaje);

    // (10)
    await this.transactionManager.runInTransaction(async (tx) => {
      await this.offerRepository.save(offer, tx);
    });
    // ---- COMMIT ----

    // (11) refillRequestId viaja null -- no hay solicitud que transicionar
    // (D6/D18-3, diferencia (c) de esta ruta).
    const payload: OfertaEnviadaPayload = {
      offerId: offer.id,
      kind: offer.kind,
      companyId,
      userId,
      refillRequestId: null,
      total: offer.total,
      tiempoEntregaHoras: entrega.tiempoEntregaHoras,
    };
    await this.eventPublisher.publish(new OfertaEnviada(payload));

    // (12) best-effort (D17) -- sendPush nunca lanza por contrato.
    await this.notificationPort.sendPush(
      userId,
      'Recibiste una nueva oferta directa de un proveedor.',
    );

    return offer;
  }
}
