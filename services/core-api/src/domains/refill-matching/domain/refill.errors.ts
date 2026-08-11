/**
 * Domain-invariant violations for `refill-matching` (core-api-refill-matching
 * spec, design.md D-E's "Errores de dominio" table). Plain `Error`
 * subclasses, zero framework imports (core-api-hexagonal-layout:
 * `domain/`/`ports-in/` MUST NOT import HTTP-framework types) — a ports-in
 * caller never throws these directly as an HTTP response;
 * `adapters/http/refill-exception.filter.ts` (Phase 4b+) maps each class to
 * a status code. All 6 classes land here in PR1 (groundwork); each is used
 * incrementally starting in the phase named below — this file is never
 * edited destructively, only appended to (mirrors `catalogo/domain/
 * catalogo.errors.ts`'s and `consumo/domain/consumo.errors.ts`'s precedent).
 */

/**
 * Maps to 404 `REFILL_REQUEST_NOT_FOUND` in `adapters/http/` (design.md's
 * error table). Thrown by `BuscarProveedoresCompatiblesUseCase` (Phase 5a)
 * and `CompletarBorradorUseCase` (Phase 6b) when `findById(refillRequestId)`
 * returns `null` OR returns a request whose `userId` does not match the
 * caller's `actor.profileId` (D13) — BOTH branches throw this exact same
 * error, constructed the exact same way (design.md Diagrama 2: "Byte a byte
 * identico al caso 'no existe'"). A 403 in the cross-tenant branch would
 * confirm the request exists and belongs to someone else, letting an actor
 * enumerate `refillRequestId` to probe another user's address/comuna/items by
 * observing 403-vs-404 — 404 in both branches closes that channel (R2, the
 * same risk `catalogo`'s `CatalogItemNotFoundError` and `consumo`'s
 * `ConsumptionNotFoundError` already closed).
 */
export class RefillRequestNotFoundError extends Error {
  constructor(refillRequestId: string) {
    super(`Solicitud de reposición ${refillRequestId} no encontrada.`);
    this.name = 'RefillRequestNotFoundError';
  }
}

/**
 * Maps to 409 `REFILL_REQUEST_EN_BORRADOR` in `adapters/http/` (design.md
 * D-F, Q6). Thrown by `BuscarProveedoresCompatiblesUseCase` (Phase 5a) when
 * the request is the caller's OWN and its `estado === 'borrador'` — checked
 * AFTER the D13 ownership/existence check, on purpose: a borrador belonging
 * to another user returns 404 (`RefillRequestNotFoundError`), never this
 * error, so this class is only reachable over a request the caller genuinely
 * owns. Distinct from `TransicionInvalidaError`: this is "this READ operation
 * does not apply in this state", not "this transition is not legal". Never
 * `[]` — an empty array is indistinguishable from "no hay proveedores", the
 * exact silent failure D3 exists to prevent.
 */
export class SolicitudEnBorradorError extends Error {
  constructor(refillRequestId: string) {
    super(`La solicitud ${refillRequestId} está en borrador y no admite matching.`);
    this.name = 'SolicitudEnBorradorError';
  }
}

/**
 * Maps to 409 `TRANSICION_INVALIDA` in `adapters/http/` (design.md's error
 * table). Thrown by `completar()` (Phase 2, `domain/refill-request.entity.ts`)
 * when a non-`'borrador'` request is passed to `completarBorrador`, and by
 * the 4-state machine's `marcarOfertada`/`marcarConfirmada` transitions
 * (Phase 2/7) when called out of order (e.g. confirming an `'abierta'`
 * request that was never `'ofertada'`). Distinct from
 * `SolicitudEnBorradorError`: this is "this TRANSITION is not legal from the
 * current state", not "this read doesn't apply to a borrador".
 */
export class TransicionInvalidaError extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'TransicionInvalidaError';
  }
}

/**
 * Maps to 400 `REFILL_REQUEST_INCOMPLETA` in `adapters/http/` (design.md's
 * error table). Thrown by `completar()` (Phase 2) when the `'borrador' ->
 * 'abierta'` transition would leave the request without `direccion`,
 * `comuna`, or any item without `categoria`/`precioReferencia` (D4) — the
 * completeness invariant this whole change exists to enforce in `core-api`,
 * never in Postgres (no CHECK is expressible across the item/request
 * tables). On rejection, the borrador argument is left untouched — no
 * mutation happens before every field is confirmed present.
 */
export class SolicitudIncompletaError extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'SolicitudIncompletaError';
  }
}

/**
 * Maps to 400 `REFILL_ITEM_DESCONOCIDO` in `adapters/http/` (design.md's
 * error table). Thrown by `CompletarBorradorUseCase` (Phase 6b) when the
 * request body's `items[].refillItemId` references an id that does not
 * belong to the borrador being completed — the input must cover exactly the
 * borrador's existing items (design.md D-E: "ni faltar ninguno... ni traer
 * ids desconocidos"), since items are updated in place, never replaced
 * (criterio de éxito: "ningún DELETE físico introducido").
 */
export class RefillItemDesconocidoError extends Error {
  constructor(refillItemId: string) {
    super(`El ítem ${refillItemId} no pertenece a esta solicitud.`);
    this.name = 'RefillItemDesconocidoError';
  }
}

/**
 * Maps to 400 `SOLICITUD_INVALIDA` in `adapters/http/` (design.md's error
 * table). Thrown by `crearSolicitudActiva()` (Phase 2, `domain/
 * refill-request.entity.ts`) when `crearSolicitud`'s manual (HTTP) input has
 * zero items, an empty `nombre`/`categoria`/`direccion`/`comuna`, or a
 * negative `precioReferencia` — validated in the domain factory, before any
 * repository call (Phase 4a).
 */
export class SolicitudInvalidaError extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'SolicitudInvalidaError';
  }
}
