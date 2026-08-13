/**
 * Domain-invariant violations for `ofertas` (core-api-ofertas spec,
 * design.md D-E's "Errores de dominio → OfertasExceptionFilter" table).
 * Plain `Error` subclasses, zero framework imports
 * (core-api-hexagonal-layout: `domain/`/`ports-in/` MUST NOT import
 * HTTP-framework types) — a ports-in caller never throws these directly as
 * an HTTP response; `adapters/http/ofertas-exception.filter.ts` (Phase 4b+)
 * maps each class to a status code. All 8 classes land here in PR1
 * (groundwork); each is used incrementally starting in the phase named
 * below — this file is never edited destructively, only appended to
 * (mirrors `refill-matching/domain/refill.errors.ts`'s precedent).
 */

/**
 * Maps to 404 `SOLICITUD_NO_ELEGIBLE` in `adapters/http/` (design.md's
 * error table). Thrown by `EnviarOfertaUseCase` (Phase 5a) when
 * `findElegible(refillRequestId, companyId)` returns `null` — a solicitud
 * that does not exist AND a solicitud that exists but where this company is
 * not eligible BOTH throw this exact same error, constructed the exact same
 * way (D11: byte-identical, never 403). A 403 would confirm the solicitud
 * exists and this company isn't the one it matched, letting a provider
 * enumerate `refillRequestId`s and probe eligibility by observing
 * 403-vs-404 — 404 in both branches closes that channel, same discipline
 * `RefillRequestNotFoundError` already established.
 */
export class SolicitudNoElegibleError extends Error {
  constructor(refillRequestId: string) {
    super(`La solicitud ${refillRequestId} no existe o esta empresa no es elegible.`);
    this.name = 'SolicitudNoElegibleError';
  }
}

/**
 * Maps to 409 `OFERTA_OPORTUNIDAD_CERRADA` in `adapters/http/` (design.md's
 * error table, Q4). Thrown by `EnviarOfertaUseCase` (Phase 5a) when
 * `oportunidad.cerradaAt !== null` — checked AFTER eligibility (D11), on
 * purpose: a non-eligible company on an already-closed opportunity still
 * gets 404, never 409 (a 409 would confirm the solicitud's existence to a
 * company that was never eligible for it). Reachable ONLY by a company that
 * IS/was eligible.
 */
export class OportunidadCerradaError extends Error {
  constructor(refillRequestId: string) {
    super(`La oportunidad de la solicitud ${refillRequestId} ya esta cerrada.`);
    this.name = 'OportunidadCerradaError';
  }
}

/**
 * Maps to 404 `DESTINATARIO_NO_ELEGIBLE` in `adapters/http/` (design.md's
 * error table, D10). Thrown by `EnviarOfertaProactivaUseCase` (Phase 6b)
 * when `existeRelacion(companyId, userId)` is `false` — indistinguishable
 * from "ese `userId` no existe" (D11), same 404-never-403 discipline: a 403
 * would let a provider enumerate `userId`s by observing 403-vs-404.
 */
export class DestinatarioNoElegibleError extends Error {
  constructor(userId: string) {
    super(`El usuario ${userId} no tiene relacion previa con esta empresa.`);
    this.name = 'DestinatarioNoElegibleError';
  }
}

/**
 * Maps to 404 `OFFER_NOT_FOUND` in `adapters/http/` (design.md's error
 * table, D11). Thrown by `AceptarOfertaUseCase` (Phase 7a) and
 * `ObtenerBandejaUseCase`'s owner-scoped reads when `findById(offerId)`
 * returns `null` OR returns an offer whose `userId` does not match the
 * caller's `actor.profileId` — BOTH branches throw this exact same error,
 * byte-identical (design.md D-D: "User A cannot accept user B's offer" and
 * "A nonexistent offerId" get the same response). Same closed-channel
 * reasoning as `SolicitudNoElegibleError`.
 */
export class OfferNotFoundError extends Error {
  constructor(offerId: string) {
    super(`Oferta ${offerId} no encontrada.`);
    this.name = 'OfferNotFoundError';
  }
}

/**
 * Maps to 409 `OFERTA_YA_ACEPTADA` in `adapters/http/` (design.md's error
 * table, R4). Thrown by `KyselyOfferRepository.marcarAceptada` (Phase 3a)
 * — never by a `ports-in/` use case directly — when the driver reports a
 * `23505` violation of `offers_refill_request_id_aceptada_uidx`: a double
 * tap of `aceptarOferta` on two sibling offers of the same
 * `refillRequestId`. Translated in the adapter, never in the use case,
 * because a Postgres error code is infrastructure vocabulary `ports-in/`
 * must not know about (same frontier `CatalogQueryUnavailableError`
 * exists behind). Any other driver error re-thrown as-is, mapped to 500.
 */
export class OfertaYaAceptadaError extends Error {
  constructor(refillRequestId: string) {
    super(`Ya existe una oferta aceptada para la solicitud ${refillRequestId}.`);
    this.name = 'OfertaYaAceptadaError';
  }
}

/**
 * Maps to 409 `TRANSICION_INVALIDA` in `adapters/http/` (design.md's error
 * table, D-G.3). Thrown by the `OfferStatus` state machine (Phase 2,
 * `domain/offer.entity.ts`) when a transition is attempted from any origin
 * state other than `'pendiente'` — including accepting the SAME offer
 * twice, which does not violate the partial unique index (same row) and
 * would otherwise be a silent no-op. Distinct from `OfertaYaAceptadaError`:
 * this is "this offer's own current state forbids the transition", not "a
 * concurrent write already changed the underlying row".
 */
export class TransicionInvalidaError extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'TransicionInvalidaError';
  }
}

/**
 * Maps to 400 `OFERTA_ITEMS_NO_DISPONIBLES` in `adapters/http/` (design.md's
 * error table, D9/D-B). Thrown by `EnviarOfertaProactivaUseCase` (Phase 6b)
 * when `CatalogQueryPort.obtenerItemsDeProveedor` returns fewer items than
 * requested — an id belonging to a competitor, non-existent, or
 * `disponible = false` was silently discarded by the port (its own
 * contract), and the caller is responsible for detecting the resulting
 * cardinality mismatch and rejecting BEFORE any write, never composing a
 * smaller offer than requested.
 */
export class ItemsNoDisponiblesError extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'ItemsNoDisponiblesError';
  }
}

/**
 * Maps to 400 `OFERTA_INVALIDA` in `adapters/http/` (design.md's error
 * table). Thrown by `crearOfertaReactiva`/`crearOfertaProactiva` (Phase 2,
 * `domain/offer.entity.ts`) for 0 items, `isAlt: true` without `altNote`,
 * a negative price; and by `EnviarOfertaUseCase` (Phase 5a) when a
 * `refillItemId` does not belong to the target solicitud — validated
 * against the `offer_opportunity_items` projection, never merely trusted
 * from client input (design.md's own "A refillItemId from another
 * solicitud is rejected" scenario).
 */
export class OfertaInvalidaError extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'OfertaInvalidaError';
  }
}
