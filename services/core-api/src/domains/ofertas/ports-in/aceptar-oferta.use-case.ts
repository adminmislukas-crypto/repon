import { Inject, Injectable } from '@nestjs/common';
import { TRANSACTION_MANAGER, type TransactionManager } from '../../../shared/database/transaction';
import {
  EVENT_PUBLISHER,
  type EventPublisher,
} from '../../../shared/event-bus/event-publisher.port';
import { aceptar } from '../domain/offer.entity';
import { OfferNotFoundError } from '../domain/oferta.errors';
import { OfertaAceptada } from '../events/oferta-aceptada.event';
import type {
  OfertaAceptadaLineaPayload,
  OfertaAceptadaPayload,
} from '../events/oferta-aceptada.payload';
import {
  OFFER_OPPORTUNITY_REPOSITORY,
  type OfferOpportunityRepository,
} from '../ports-out/offer-opportunity-repository.port';
import { OFFER_REPOSITORY, type OfferRepository } from '../ports-out/offer-repository.port';

/**
 * `ofertas/SPEC.md`'s `aceptarOferta(offerId): Promise<void>` — design.md
 * D-D, "tres escrituras, una transacción". Este es el caso de uso
 * transaccionalmente más complejo del dominio, y su forma es
 * DELIBERADAMENTE distinta a la de `EnviarOfertaUseCase` (Phase 5a): acá no
 * existe ningún puerto ajeno (`CatalogQueryPort`) que resolver antes de
 * abrir la transacción, así que TODO el flujo — desde `findById` hasta el
 * displacement — vive DENTRO de un único `runInTransaction`. No hay un
 * "afuera de la tx" en este caso de uso; el test D-C de PR5a (orden
 * catálogo-antes-que-tx) no tiene equivalente acá porque no hay nada que
 * ordenar contra la transacción.
 *
 * ## Constructor: 4 tokens — NUNCA `CATALOG_QUERY_PORT` ni
 * `NOTIFICATION_PORT`
 *
 * `OFFER_REPOSITORY` + `OFFER_OPPORTUNITY_REPOSITORY` (las 2 escrituras) +
 * `TRANSACTION_MANAGER` (D12: atomicidad no es opcional acá) +
 * `EVENT_PUBLISHER`. Sin `NOTIFICATION_PORT`: design.md §D-G ("no hay push
 * al proveedor y por qué") — `NotificationPort.sendPush` toma un
 * `profileId`, y en `aceptarOferta` solo tenemos `companyId`; resolver
 * empresa → perfiles exigiría un contrato nuevo contra `identidad` que
 * nadie pidió. El push al proveedor queda fuera de este cambio.
 *
 * ## Flujo (design.md D-D, verbatim)
 *
 * ```
 * runInTransaction(async (tx) => {
 *   1. offerRepository.findById(offerId, tx)
 *        null || offer.userId !== profileId -> OfferNotFoundError      (404, byte-idéntico, D18-2)
 *        offer.status !== 'pendiente'       -> TransicionInvalidaError (409, D-G.3, vía aceptar())
 *   2. offerRepository.marcarAceptada(offerId, tx)              -- UPDATE angosto de 1 columna
 *   3. if (offer.kind === 'reactiva') {                         -- refillRequestId !== null
 *        desplazadas = offerRepository.desplazarHermanas(offer.refillRequestId, offerId, tx)
 *        opportunityRepository.cerrar(offer.refillRequestId, tx)
 *      } else { desplazadas = [] }                              -- rama PROBADA, no muerta (D12)
 * })
 * -- COMMIT --
 * 4. eventPublisher.publish(new OfertaAceptada({ offerId, companyId, userId,
 *                                                refillRequestId, total, desplazadas }))
 * ```
 *
 * 1. `findById(offerId, tx)` — CON `tx`: a diferencia de
 *    `EnviarOfertaUseCase`, acá la transacción YA está abierta cuando se
 *    lee. `found === null || found.userId !== profileId` colapsan en UNA
 *    sola rama que lanza `OfferNotFoundError(offerId)` — el mismo
 *    constructor, el mismo argumento, byte a byte idéntico en ambos casos
 *    (D11/D18-2: un 403 confirmaría a un atacante que la oferta existe y es
 *    de otra persona).
 * 2. `aceptar(found)` (Phase 2, `domain/offer.entity.ts`) — función PURA que
 *    valida la transición: `found.status !== 'pendiente'` lanza
 *    `TransicionInvalidaError` (409, D-G.3) ANTES de cualquier escritura.
 *    Devuelve un objeto NUEVO con `status: 'aceptada'` — este objeto NUNCA
 *    se persiste vía `save()` (reescribiría `items`, que design.md D12
 *    rechaza explícitamente); solo se usa para leer sus campos (`kind`,
 *    `refillRequestId`, `companyId`, `userId`, `total`) para el resto de
 *    este método y para el payload del evento.
 * 3. `offerRepository.marcarAceptada(offerId, tx)` — el UPDATE angosto de 1
 *    columna que de verdad persiste la transición. Si el driver reporta
 *    `23505` sobre `offers_refill_request_id_aceptada_uidx` (una carrera de
 *    doble-tap sobre 2 ofertas hermanas), el ADAPTADOR (Phase 3a) ya
 *    traduce eso a `OfertaYaAceptadaError` — este caso de uso NO la captura,
 *    la deja propagar tal cual (R4): un error de dominio nunca se envuelve
 *    ni se traga acá.
 * 4. `offer.kind === 'reactiva'` (por lo tanto `offer.refillRequestId` es
 *    `string`, nunca `null`, gracias al discriminated union de `Offer`) ->
 *    `desplazarHermanas` + `cerrar`. Una oferta `'proactiva'` NO llama a
 *    ninguno de los dos — rama PROBADA por tasks.md 7a.4, no muerta.
 *    `desplazadas` es EXACTAMENTE lo que `desplazarHermanas`'s propio
 *    `UPDATE ... RETURNING id` devolvió, nunca una lista calculada aparte
 *    (design.md D-D: "exacto y gratis, sin SELECT previo ni carrera").
 * 5. DESPUÉS del commit (`runInTransaction` resuelto): `eventPublisher
 *    .publish(new OfertaAceptada(...))`. Sin `sendPush` acá — ver la nota
 *    del constructor arriba.
 */
@Injectable()
export class AceptarOfertaUseCase {
  constructor(
    @Inject(OFFER_REPOSITORY) private readonly offerRepository: OfferRepository,
    @Inject(OFFER_OPPORTUNITY_REPOSITORY)
    private readonly opportunityRepository: OfferOpportunityRepository,
    @Inject(TRANSACTION_MANAGER) private readonly transactionManager: TransactionManager,
    @Inject(EVENT_PUBLISHER) private readonly eventPublisher: EventPublisher,
  ) {}

  async execute(profileId: string, offerId: string): Promise<void> {
    const { offer, desplazadas } = await this.transactionManager.runInTransaction(async (tx) => {
      // (1) con tx: la transaccion ya esta abierta cuando se lee.
      const found = await this.offerRepository.findById(offerId, tx);

      // (1, cont.) UNA sola rama -- byte a byte idéntico (D11/D18-2).
      if (found === null || found.userId !== profileId) {
        throw new OfferNotFoundError(offerId);
      }

      // (2) valida la transicion (409 si found.status !== 'pendiente'),
      // NUNCA se persiste este objeto via save() (D12).
      const aceptada = aceptar(found);

      // (3) UPDATE angosto de 1 columna. Un 23505 se traduce en el
      // adaptador (Phase 3a) -> OfertaYaAceptadaError, propaga sin catch (R4).
      await this.offerRepository.marcarAceptada(offerId, tx);

      // (4) rama PROBADA, no muerta (D12).
      let desplazadasIds: readonly string[] = [];
      if (aceptada.kind === 'reactiva') {
        desplazadasIds = await this.offerRepository.desplazarHermanas(
          aceptada.refillRequestId,
          offerId,
          tx,
        );
        await this.opportunityRepository.cerrar(aceptada.refillRequestId, tx);
      }

      return { offer: aceptada, desplazadas: desplazadasIds };
    });
    // ---- COMMIT ----

    // (5) `backend-core-api-pedidos-pagos` D1/D-B.4: `lineas`/`costoDespacho`
    // salen de `offer` (la misma `aceptada` que `aceptar()` devolvió en (2)),
    // que YA tiene `items` hidratados por el `findById` de (1) — cero
    // round-trips nuevos, verificado contra el código (design.md D-B.1).
    const lineas: readonly OfertaAceptadaLineaPayload[] = offer.items.map((item) => ({
      offerItemId: item.id,
      nombre: item.nombre,
      precio: item.precio,
      isAlt: item.isAlt,
      altSize: item.altSize,
      altQty: item.altQty,
      altNote: item.altNote,
    }));

    const payload: OfertaAceptadaPayload = {
      offerId: offer.id,
      companyId: offer.companyId,
      userId: offer.userId,
      refillRequestId: offer.kind === 'reactiva' ? offer.refillRequestId : null,
      total: offer.total,
      desplazadas,
      costoDespacho: offer.costoDespacho,
      lineas,
    };
    await this.eventPublisher.publish(new OfertaAceptada(payload));
  }
}
