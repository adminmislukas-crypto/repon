/**
 * design.md D-F/D7, tasks.md 8a.1 — `refill-matching`'s locally-declared
 * shape for the 2 fields it actually consumes from `ofertas`' real
 * `OfertaEnviada`/`OfertaAceptada` events (`domains/ofertas/events/
 * oferta-enviada.payload.ts` / `oferta-aceptada.payload.ts`, which carry 5-6
 * fields each). Deliberately NOT importing `ofertas`' real event classes or
 * their full payload interfaces — `oferta-enviada.listener.ts`/
 * `oferta-aceptada.listener.ts` subscribe by channel-NAME STRING
 * (`'ofertas.oferta_enviada'`/`'ofertas.oferta_aceptada'`) and type the
 * payload with THESE interfaces instead, the in-process equivalent of a
 * broker consumer deserializing against its own schema. Same literal pattern
 * `refill-matching/adapters/events/consumo-event.payloads.ts` already
 * established for `consumo` and `ofertas/adapters/events/
 * refill-matching-event.payloads.ts` established in the OPPOSITE direction
 * for `refill-matching` (design.md D-F cites both directly as the template)
 * — this file is their structural mirror, adapted from
 * `ofertas`/`refill-matching` this time.
 *
 * Both fields are REQUIRED, never optional: `MarcarComoOfertadaUseCase`/
 * `MarcarComoConfirmadaUseCase.execute(refillRequestId: string)` has no
 * fallback for a missing `offerId`/`refillRequestId` key — an event missing
 * either is malformed, not degraded.
 *
 * `refillRequestId: string | null` is the field this whole PR branches on
 * (D6/D18-3): `null` means a PROACTIVE offer, which has no `RefillRequest`
 * to transition — the listener's own early `return`, never a `?.`/cast.
 * `offerId` travels for the log line only (`logger.error({ evento, offerId,
 * refillRequestId }, ...)`) — neither listener does anything else with it,
 * same as `MatchEncontradoListener`'s own use of its payload fields in the
 * error-log path.
 */
export interface OfertaEnviadaPayload {
  readonly offerId: string;
  readonly refillRequestId: string | null;
}

export interface OfertaAceptadaPayload {
  readonly offerId: string;
  readonly refillRequestId: string | null;
}
