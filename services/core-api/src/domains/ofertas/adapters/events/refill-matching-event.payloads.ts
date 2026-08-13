import type { Urgencia } from '@repon/types';

/**
 * design.md D-F, tasks.md 4a.1 — `ofertas`' locally-declared shape for the
 * fields it actually consumes from `refill-matching`'s real
 * `MatchEncontrado` event (`domains/refill-matching/events/match-encontrado.payload.ts`,
 * which itself extends `RefillSolicitudPayload`). Deliberately NOT importing
 * `refill-matching`'s real event class or its real payload interface —
 * `match-encontrado.listener.ts` subscribes by channel-NAME STRING
 * (`'refill.match_encontrado'`) and types the payload with THIS interface
 * instead, the in-process equivalent of a broker consumer deserializing
 * against its own schema. Same literal pattern
 * `refill-matching/adapters/events/consumo-event.payloads.ts` already
 * established for `consumo` (design.md D-F cites that file directly as the
 * template) — this file is its structural copy, adapted from
 * `refill-matching`/`consumo` to `ofertas`/`refill-matching`.
 *
 * `Urgencia` is imported from `@repon/types`, NEVER from
 * `domains/refill-matching/*` — it is the monorepo's shared vocabulary (the
 * same package `SolicitudElegible.urgencia` in `packages/types/src/ofertas.ts`
 * already reuses), not another domain's code. The rule this file preserves
 * is "never import the sibling domain's EVENT CLASS", and importing a
 * shared-kernel type does not break it (design.md D-A.1 makes the identical
 * argument for why `Urgencia` — but never `public.refill_urgencia` — is safe
 * to reuse at the TypeScript layer even though the Postgres column is `text`).
 *
 * **The field that matters most in this file is the one it OMITS.** The
 * real `MatchEncontrado` payload also carries `providerCatalogItemIds:
 * readonly string[]` (the full, non-deduplicated set of `provider_catalog`
 * ids that matched at search time). This interface does not declare that
 * field — deliberately, and that omission IS the D8 enforcement: `ofertas`
 * must never persist a snapshot of another domain's catalog ids (prices go
 * stale, and a hidden company's ids would freeze past C4's visibility
 * filter). A field that does not exist in the type cannot be persisted by
 * accident, nor "recovered" by a future refactor that widens this interface
 * to match the real payload more closely — the architectural decision is
 * enforced by the type system, not by a comment someone could miss.
 */
export interface MatchEncontradoItemPayload {
  /** `refill_items.id` — the key `registrarOportunidad` writes 1:1 into
   *  `offer_opportunity_items.refill_item_id` (PK of that table). */
  readonly refillItemId: string;
  readonly nombre: string;
  /** Required, never optional: `MatchEncontrado` is only ever published over
   *  an active solicitud (`RefillRequestActiva` guarantees both fields). */
  readonly categoria: string;
  readonly precioReferencia: number;
  readonly catalogProductId: string | null;
}

export interface MatchEncontradoPayload {
  readonly refillRequestId: string;
  /** `offer_opportunities.user_id` — `enviarOferta` reads `offers.user_id`
   *  from here, never from a join against `refill_requests` (no synchronous
   *  path exists back into `refill-matching`, design.md D-A). */
  readonly userId: string;
  readonly comuna: string;
  readonly urgencia: Urgencia;
  /**
   * Empresas con al menos una coincidencia. Published even as `[]` — "buscamos
   * y no hay nadie" is a fact `refill-matching` owns and `registrarOportunidad`
   * must still act on (D2/D5): the header is written regardless, only the
   * companies-upsert step (step 3 of the writer) is omitted.
   */
  readonly companyIds: readonly string[];
  readonly items: readonly MatchEncontradoItemPayload[];
  // `providerCatalogItemIds` NO SE DECLARA A PROPOSITO — ver el doc comment
  // de la interfaz de arriba. Este es el enforcement real de D8.
}
