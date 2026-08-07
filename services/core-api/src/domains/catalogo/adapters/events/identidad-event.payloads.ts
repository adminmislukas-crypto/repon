/**
 * design.md D-A: `catalogo`'s locally-declared shape for the `identidad`
 * event payloads its `adapters/events/` listener consumes — deliberately
 * NOT importing `identidad`'s event classes
 * (`EmpresaSuspendida`/`EmpresaReactivada`/`EmpresaAprobada`).
 * `company-visibility.listener.ts` subscribes by channel-NAME STRING
 * (`'empresa.suspendida'`, `'empresa.reactivada'`, `'empresa.aprobada'`)
 * and types the payload with THIS interface instead — the in-process
 * equivalent of a broker consumer deserializing against its own schema, so
 * `catalogo` never fails to compile the day `identidad` gets extracted to
 * its own service.
 *
 * `motivo` is deliberately OPTIONAL here even though `EmpresaSuspendida`'s
 * own payload declares it required (and `EmpresaAprobada` has no `motivo`
 * field at all) — the consumer must never break if the producer's field
 * becomes optional, or absent, later.
 *
 * The `RESTRICTED_SUBPATHS` ESLint rule (`eslint.config.js`) does not
 * technically forbid importing `identidad/events/*` today (only
 * `adapters/events`, not the bare `events` folder, is a restricted
 * subpath) — this file exists anyway, on design.md's explicit
 * architectural rule, not because the lint gap requires it.
 *
 * Cost of this decision, named explicitly: with no compile-time link, a
 * renamed `type` string in `identidad` breaks this listener SILENTLY.
 * Mitigated by Phase 8b's mandatory cross-domain contract test
 * (`services/core-api/test/catalogo-visibility.contract-spec.ts`), which
 * publishes REAL `identidad` event instances through the real
 * `EVENT_PUBLISHER` and asserts the projection actually changed.
 */
export interface EmpresaOcultablePayload {
  readonly companyId: string;
  readonly motivo?: string;
}
