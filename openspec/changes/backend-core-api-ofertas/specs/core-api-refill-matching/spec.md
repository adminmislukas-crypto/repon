# Delta for core-api-refill-matching

## MODIFIED Requirements

### Requirement: marcarComoOfertada and marcarComoConfirmada gain their first caller: 2 listeners added by ofertas inside this domain's own adapters/events/

(Previously: both use cases existed, implemented and unit-tested, but with NO HTTP surface and NO caller anywhere in the repo.)

Both use cases MUST still NOT be reachable via any HTTP route in `refill-matching` itself. Their first caller is now 2 listeners — added by `backend-core-api-ofertas` (D7), not by this domain's own change — living in `refill-matching/adapters/events/`, subscribing by channel-name string to `'ofertas.oferta_enviada'` and `'ofertas.oferta_aceptada'`, with their own local `ofertas-event.payloads.ts` (never importing `ofertas`' event classes). Neither `marcar-como-ofertada.use-case.ts` nor `marcar-como-confirmada.use-case.ts` is edited.

#### Scenario: Neither method is HTTP-reachable

- GIVEN `refill-matching`'s `adapters/http/` controller
- WHEN its routes are enumerated
- THEN none of them invoke `marcarComoOfertada` or `marcarComoConfirmada`

#### Scenario: A proactive OfertaEnviada does not call marcarComoOfertada

- GIVEN an `OfertaEnviada` event with `refillRequestId: null` (a proactive offer)
- WHEN the new `OfertaEnviadaListener` handles it
- THEN it does NOT call `MarcarComoOfertadaUseCase.execute` — there is no `RefillRequest` to transition

#### Scenario: A proactive OfertaAceptada does not call marcarComoConfirmada

- GIVEN an `OfertaAceptada` event with `refillRequestId: null`
- WHEN the new `OfertaAceptadaListener` handles it
- THEN it does NOT call `MarcarComoConfirmadaUseCase.execute`

#### Scenario: A reactive OfertaEnviada calls marcarComoOfertada exactly once

- GIVEN an `OfertaEnviada` event with `refillRequestId: R` (a reactive offer)
- WHEN the `OfertaEnviadaListener` handles it
- THEN `MarcarComoOfertadaUseCase.execute(R)` is called exactly once, transitioning R to `'ofertada'`

#### Scenario: A reactive OfertaAceptada calls marcarComoConfirmada exactly once

- GIVEN an `OfertaAceptada` event with `refillRequestId: R`
- WHEN the `OfertaAceptadaListener` handles it
- THEN `MarcarComoConfirmadaUseCase.execute(R)` is called exactly once, transitioning R to `'confirmada'`

#### Scenario: Neither listener re-throws back into ofertas

- GIVEN either new listener's wrapped use-case call throws
- WHEN the listener's handler runs
- THEN the error is caught and logged, never re-thrown — `enviarOferta`/`aceptarOferta` already committed and must not surface a failure to the provider/user after the fact

### Requirement: refill-matching's folder contains adapters/events/ with 3 listeners; the module boundary stays otherwise unchanged

(Previously: `adapters/events/` contained exactly 1 `@OnEvent` listener; `contracts/` and `adapters/scheduling/` absent.)

`services/core-api/src/domains/refill-matching/` MUST still contain `adapters/events/` and MUST still NOT contain `contracts/` or `adapters/scheduling/`. `adapters/events/` now holds 3 listeners: the original `RefillAutoSolicitadoListener` plus the 2 new ones added by `backend-core-api-ofertas`. `refill-matching.module.ts` MUST change only its `providers` array to register the 2 new listeners — `imports`, `controllers`, and `exports` MUST remain byte-identical to before this change (D7): zero new module-graph edges.

#### Scenario: The module's public surface is untouched

- GIVEN `refill-matching.module.ts` before and after this change
- WHEN `imports`, `controllers`, and `exports` are diffed
- THEN they are identical — only `providers` gained 2 entries

#### Scenario: Folder shape holds with 3 listeners

- GIVEN `refill-matching`'s folder tree after this change
- WHEN it is inspected
- THEN `adapters/events/` contains exactly 3 `@OnEvent` listeners, and no `contracts/` or `adapters/scheduling/` directory exists
