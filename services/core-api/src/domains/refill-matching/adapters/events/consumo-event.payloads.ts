/**
 * design.md D-G.1/Diagrama 3: `refill-matching`'s locally-declared shape for
 * the 3 fields it actually consumes from `consumo`'s `RefillAutoSolicitado`
 * event — deliberately NOT importing `consumo`'s real event class
 * (`RefillAutoSolicitado`) or its full `StockBajoPayload` (which carries 8
 * more fields this domain has no use for: `ownerType`, `petId`, `kind`,
 * `unidad`, `stockActual`, `consumoDiario`, `diasRestantes`, `umbralDias`).
 * `refill-auto-solicitado.listener.ts` subscribes by channel-NAME STRING
 * (`'consumo.refill_auto_solicitado'`) and types the payload with THIS
 * interface instead — the in-process equivalent of a broker consumer
 * deserializing against its own schema, so `refill-matching` never fails to
 * compile the day `consumo` is extracted to its own service. Same literal
 * pattern `catalogo/adapters/events/identidad-event.payloads.ts` already
 * established for `identidad` — this file is its direct structural copy,
 * adapted from `catalogo`/`identidad` to `refill-matching`/`consumo`.
 *
 * Unlike `EmpresaOcultablePayload.motivo?` (optional), all 3 fields here are
 * REQUIRED: `crearBorradorRefill` (design.md D-G.1) has no fallback for a
 * missing `consumptionId`/`userId`/`nombre` — an event missing any of them
 * is not a degraded case, it is a malformed one.
 *
 * The `RESTRICTED_SUBPATHS` ESLint rule (`eslint.config.js`) does not
 * technically forbid importing `consumo/events/*` today (only
 * `adapters/events`, not the bare `events` folder, is a restricted
 * subpath) — this file exists anyway, on design.md's explicit
 * architectural rule, not because the lint gap requires it.
 *
 * Cost of this decision, named explicitly: with no compile-time link, a
 * renamed `type` string in `consumo` breaks this listener SILENTLY.
 * Mitigated by tasks.md 6a.7's mandatory cross-domain contract test
 * (`services/core-api/test/refill-auto-solicitado.e2e-spec.ts`), which
 * publishes a REAL `consumo` `RefillAutoSolicitado` instance through the
 * real `EVENT_PUBLISHER` and asserts a `'borrador'` `RefillRequest` actually
 * gets created.
 */
export interface RefillAutoSolicitadoPayload {
  readonly consumptionId: string;
  readonly userId: string;
  readonly nombre: string;
}
