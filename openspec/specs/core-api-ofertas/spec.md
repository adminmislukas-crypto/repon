# core-api-ofertas Specification

## Purpose

The `ofertas` domain vertical: 6 use cases (`enviarOferta`, `enviarOfertaProactiva`, `aceptarOferta`, `obtenerBandeja`, `listarSolicitudesElegibles`, `registrarOportunidad`), their HTTP surface and roles, cross-tenant authorization where every cross-tenant read/write is 404 never 403 (D10/D11), the discovery projection's replace semantics (D1/D5), fresh price re-querying via `CatalogQueryPort` (D8), the transactional split and the mandatory call-order for `CatalogQueryPort` (D12/D13), exclusive consumption of `MatchEncontrado` (D2), and the 2 published events (D6).

## Requirements

### Requirement: registrarOportunidad consumes MatchEncontrado only; RefillCreado is never subscribed

The `adapters/events/` listener MUST subscribe only to the `refill.match_encontrado` channel by string name, never importing `refill-matching`'s event class, and MUST invoke `registrarOportunidad` — an internal-only use case with no HTTP route — exactly once per event (D2). The domain MUST NOT subscribe to `refill.refill_creado` in any form: that payload carries no `companyIds`, so no eligibility fact exists to project.

#### Scenario: RefillCreado alone creates no opportunity

- GIVEN a `RefillCreado` event is emitted, with no corresponding `MatchEncontrado`
- WHEN the event bus dispatches it
- THEN no listener in `ofertas` handles it, and no `offer_opportunities` row is created

#### Scenario: A MatchEncontrado with companyIds: [] still writes the header

- GIVEN a `MatchEncontrado` for `refillRequestId` R with `companyIds: []`
- WHEN `registrarOportunidad` executes
- THEN an `offer_opportunities` row for R is written, with zero eligible companies — the event is never suppressed

#### Scenario: A MatchEncontrado with companies creates the opportunity and its eligible set

- GIVEN a `MatchEncontrado` for R with `companyIds: [A, B]`
- WHEN `registrarOportunidad` executes
- THEN R has one `offer_opportunities` row and exactly 2 `offer_opportunity_companies` rows (A, B)

### Requirement: registrarOportunidad replaces the eligible set per solicitud; it never accumulates

Each `MatchEncontrado` for a `refillRequestId` MUST replace, inside one transaction, the full set of eligible companies and items for that solicitud — never append to a prior run's set (D5). `TRANSACTION_MANAGER` MUST be injected, since the replace crosses 3 tables.

#### Scenario: A second MatchEncontrado with fewer companies expels the vanished provider

- GIVEN R already has eligible companies [A, B] from a prior `MatchEncontrado`
- WHEN a second `MatchEncontrado` for R arrives with `companyIds: [A]` (B no longer matches)
- THEN B is no longer readable as eligible for R, and A remains

#### Scenario: A same-companies re-run is idempotent

- GIVEN R already has eligible companies [A, B]
- WHEN a `MatchEncontrado` for R arrives again with `companyIds: [A, B]`
- THEN R still has exactly [A, B] eligible, with no duplicate rows

### Requirement: The MatchEncontrado listener never re-throws

Same as `refill-matching`'s `RefillAutoSolicitadoListener` and `catalogo`'s `CompanyVisibilityListener`: a failure inside `registrarOportunidad` MUST be caught and logged by the listener, never re-thrown back into `refill-matching`'s `buscarProveedoresCompatibles` (R5).

#### Scenario: A projection write failure does not propagate to the emitter

- GIVEN `registrarOportunidad` throws while handling a `MatchEncontrado`
- WHEN the listener's handler runs
- THEN the error is logged, not re-thrown — `buscarProveedoresCompatibles` completes successfully regardless

### Requirement: listarSolicitudesElegibles is scoped to the actor's own companyId and excludes closed opportunities

`listarSolicitudesElegibles()` MUST derive `companyId` exclusively from `actor.companyId` — no DTO accepts it (D11) — and MUST return only solicitudes where that company currently appears in `offer_opportunity_companies` AND the opportunity is not yet closed (`aceptarOferta` closes it, D12). `TRANSACTION_MANAGER` MUST NOT be injected (D13).

#### Scenario: A closed opportunity does not appear in any provider's list

- GIVEN R's opportunity was closed by a prior `aceptarOferta`
- WHEN any previously-eligible company calls `listarSolicitudesElegibles`
- THEN R does not appear in the result, for any of them

#### Scenario: A provider sees only solicitudes where their own company is eligible

- GIVEN company A is eligible for R1 and R2; company B is eligible only for R2
- WHEN A calls `listarSolicitudesElegibles`
- THEN A receives [R1, R2], never any solicitud where A is not eligible

### Requirement: enviarOferta requires current eligibility for the target solicitud; ineligible or nonexistent is 404, byte-identical

`enviarOferta(refillRequestId, items, entrega)` MUST derive `companyId` from `actor.companyId` and verify, against `offer_opportunity_companies`, that this company is currently eligible for `refillRequestId`. A solicitud that does not exist and a solicitud that exists but where this company is not eligible MUST both throw the same error class, `SolicitudNoElegibleError`, byte-identical, mapped to HTTP 404 — never 403 (D11).

#### Scenario: A non-eligible company is rejected with 404

- GIVEN R exists but company A is not among its eligible companies
- WHEN A calls `enviarOferta(R, items, entrega)`
- THEN the response is HTTP 404, and the thrown error is byte-identical to the nonexistent-R case

#### Scenario: A nonexistent refillRequestId is rejected with the same 404

- GIVEN no `offer_opportunities` row exists for id X
- WHEN a provider calls `enviarOferta(X, items, entrega)`
- THEN the response is HTTP 404, indistinguishable from the not-eligible case

#### Scenario: An eligible company successfully composes the offer

- GIVEN company A is eligible for R
- WHEN A calls `enviarOferta(R, items, entrega)` with items belonging to R
- THEN the offer is created with `status: 'pendiente'`

### Requirement: enviarOferta on an already-closed opportunity is rejected explicitly, never silently pending forever

Resolved here (Q4): when R's opportunity is already closed (a prior `aceptarOferta` for R succeeded), `enviarOferta` MUST reject with a distinct error, `OportunidadCerradaError`, mapped to HTTP 409 — never accepted as a live `'pendiente'` offer against a request nobody will ever act on again, and never conflated with D11's 404 (the company IS/was eligible; the opportunity is simply closed). Same discipline `refill-matching`'s `'borrador'` → 409 `REFILL_REQUEST_EN_BORRADOR` already established: 404 stays reserved strictly for existence/ownership/eligibility.

#### Scenario: An offer against a closed opportunity is rejected with 409, not 404

- GIVEN R's opportunity was already closed by a prior `aceptarOferta`
- WHEN a company still listed in `offer_opportunity_companies` for R calls `enviarOferta(R, ...)`
- THEN the response is HTTP 409 `OFERTA_OPORTUNIDAD_CERRADA` — never 404, never a silently created `'pendiente'` offer

#### Scenario: An open opportunity is unaffected by this rule

- GIVEN R's opportunity has not been closed
- WHEN an eligible company calls `enviarOferta(R, ...)`
- THEN the call proceeds normally to the eligibility/pricing/transaction flow — this rule only blocks the closed case

### Requirement: enviarOferta derives offers.user_id from the projection; every item must belong to the solicitud

`offers.user_id` MUST be set from `offer_opportunities.user_id` — never from a join against `refill_requests` (D1, honoring `refill-matching`'s D7 no-`contracts/` decision without a synchronous cross-domain call). Every `refillItemId` in `items` MUST belong to `refillRequestId`, validated against `offer_opportunity_items` — never merely trusted from client input.

#### Scenario: A refillItemId from another solicitud is rejected

- GIVEN R's items are [I1, I2] in `offer_opportunity_items`, and I3 belongs to a different solicitud
- WHEN `enviarOferta(R, [..., I3, ...], entrega)` is called
- THEN the call is rejected before any write — I3 does not belong to R

#### Scenario: offers.user_id matches the projection, not a fresh join

- GIVEN R's `offer_opportunities.user_id` is U
- WHEN `enviarOferta(R, items, entrega)` succeeds
- THEN the created offer's `user_id` equals U

### Requirement: enviarOferta re-queries CatalogQueryPort for fresh prices; the projection never stores a catalog item reference

`offer_opportunity_items` MUST NOT persist any `provider_catalog`/`providerCatalogItemId` reference — only `refill-matching`'s own vocabulary (`nombre`, `categoria`, `precio_referencia`, `catalog_product_id`). `enviarOferta` MUST call `CatalogQueryPort.buscarCoincidencias` at composition time to obtain current prices and visibility, never trusting a price computed from a past `MatchEncontrado` (D8).

#### Scenario: The projection carries no catalog item reference

- GIVEN the projection schema
- WHEN `offer_opportunity_items`'s columns are inspected
- THEN no `provider_catalog_item_id` or equivalent column exists — pricing always comes from a live query, never a stored snapshot

#### Scenario: A price change after the match is reflected in the offer

- GIVEN `catalogo` changed a product's price after the `MatchEncontrado` that created R's opportunity
- WHEN A calls `enviarOferta(R, items, entrega)`
- THEN the price used to compose the offer is the current one from `CatalogQueryPort`, not a stale snapshot

### Requirement: enviarOferta calls CatalogQueryPort before opening any transaction, never inside one

The mandatory order (D13, C2): (1) verify eligibility, (2) call `CatalogQueryPort.buscarCoincidencias` **outside** any `runInTransaction`, (3) compute `total` in the domain, (4) open the transaction and write `offer`+`offer_items`, (5) commit, (6) publish `OfertaEnviada` and send the push. `CatalogQueryUnavailableError` MUST map to HTTP 503 `CATALOG_UNAVAILABLE` — the offer MUST NOT degrade to stale or omitted prices. The exact mechanism used to verify this order in tests (an interaction assertion vs. review-only) is design.md's call (Q7); this requirement fixes the observable order itself.

#### Scenario: A catalog outage maps to 503, never a degraded offer

- GIVEN `CatalogQueryPort.buscarCoincidencias` throws `CatalogQueryUnavailableError`
- WHEN `enviarOferta` is called via HTTP
- THEN the response is HTTP 503 `CATALOG_UNAVAILABLE`, and no offer is persisted

#### Scenario: The catalog port resolves before the transaction opens

- GIVEN a successful `enviarOferta` call
- WHEN its execution is inspected
- THEN `CatalogQueryPort.buscarCoincidencias` has already resolved by the time `TRANSACTION_MANAGER.runInTransaction` is invoked

### Requirement: enviarOfertaProactiva's recipient must already have a qualifying relationship with the company; otherwise 404

`enviarOfertaProactiva(userId, items, entrega, mensaje?)` MUST verify, against the D1 projection, that at least one `offer_opportunities` row exists where `userId` is the owner AND this company appears in its `offer_opportunity_companies` (D10). No such relationship MUST throw `DestinatarioNoElegibleError`, mapped to HTTP 404 — never 403, and never distinguishable from "userId does not exist".

#### Scenario: A userId with no matching relationship is rejected with 404

- GIVEN company A has never been eligible for any solicitud belonging to user U
- WHEN A calls `enviarOfertaProactiva(U, items, entrega)`
- THEN the response is HTTP 404, indistinguishable from an unknown `userId`

#### Scenario: A userId with a prior match qualifies as a recipient

- GIVEN user U had a solicitud where company A was eligible (even if U never accepted A's offer)
- WHEN A calls `enviarOfertaProactiva(U, items, entrega)`
- THEN the call proceeds — "matched at least once" is a sufficient relationship

### Requirement: enviarOfertaProactiva validates its items against the offering company's own catalog

`enviarOfertaProactiva` MUST validate every `providerCatalogItemId` in `items` via `CatalogQueryPort`'s new company-scoped method (D9; **provisional signature pending design.md's Q2**: `obtenerItemsDeProveedor(companyId: string, ids: readonly string[]): Promise<ProviderCatalogItem[]>`). Ids belonging to another company or that do not exist MUST be silently discarded by the port per its own delta spec; the caller MUST compare the returned cardinality against the requested one and reject the call if they differ, rather than silently composing a smaller offer.

#### Scenario: An id belonging to a competitor is rejected, not silently dropped

- GIVEN company A submits an item citing `providerCatalogItemId` X, which belongs to company B
- WHEN `enviarOfertaProactiva` validates the items
- THEN `obtenerItemsDeProveedor` omits X from its result, the cardinality mismatch is detected, and the call is rejected before any write

#### Scenario: All items belong to the offering company

- GIVEN every `providerCatalogItemId` in the request belongs to company A and is `disponible`
- WHEN A calls `enviarOfertaProactiva`
- THEN the offer is created with `status: 'pendiente'`

### Requirement: aceptarOferta is owner-scoped; a non-owner's attempt is 404, never 403

`aceptarOferta(offerId)` MUST derive `userId` from `actor.profileId`. An offer that does not exist and an offer that exists but belongs to another user MUST both throw the same byte-identical error, `OfferNotFoundError`, mapped to HTTP 404 — never 403 (D11).

#### Scenario: User A cannot accept user B's offer

- GIVEN offer O belongs to user B
- WHEN user A calls `aceptarOferta(O)`
- THEN the response is HTTP 404, byte-identical to a nonexistent offerId

#### Scenario: A nonexistent offerId is rejected with the same 404

- GIVEN no offer exists with id X
- WHEN any authenticated user calls `aceptarOferta(X)`
- THEN the response is HTTP 404, indistinguishable from the cross-tenant case

#### Scenario: The owner accepts their own offer

- GIVEN offer O belongs to user A, `status: 'pendiente'`
- WHEN A calls `aceptarOferta(O)`
- THEN O transitions to `'aceptada'`

### Requirement: aceptarOferta accepts, displaces siblings, and closes the opportunity in one transaction

`aceptarOferta` MUST, inside a single `TRANSACTION_MANAGER.runInTransaction`: (1) transition the target offer to `'aceptada'`, (2) transition every other `'pendiente'` sibling sharing the same `refillRequestId` to `'rechazada'`, (3) close the corresponding `offer_opportunities` row (D12). A proactive offer (`refillRequestId IS NULL`) MUST skip (2) and (3) entirely — no siblings, no opportunity to close, a tested branch, not a dead one. A partial-unique-index violation on double acceptance MUST map to HTTP 409, never 500. `OfertaAceptada` MUST publish only after commit.

#### Scenario: Accepting a proactive offer displaces nothing and closes nothing

- GIVEN offer O is `kind: 'proactiva'`, `refillRequestId: null`, `status: 'pendiente'`
- WHEN its owner calls `aceptarOferta(O)`
- THEN O becomes `'aceptada'`, no other offer changes state, and no `offer_opportunities` row is touched

#### Scenario: A double-tap race maps to 409, never 500

- GIVEN two near-simultaneous `aceptarOferta` calls for two different offers of the same `refillRequestId`
- WHEN the second write hits the partial unique index
- THEN the response is HTTP 409, never HTTP 500

#### Scenario: Accepting a reactive offer displaces its siblings and closes the opportunity

- GIVEN R has offers A (`pendiente`), B (`pendiente`), C (`pendiente`)
- WHEN the user accepts B
- THEN B becomes `'aceptada'`, A and C become `'rechazada'`, and R's `offer_opportunities` row is closed

### Requirement: TRANSACTION_MANAGER is injected only in the 4 write use cases; never in the 2 reads

`enviarOferta`, `enviarOfertaProactiva`, `aceptarOferta`, and `registrarOportunidad` MUST inject `TRANSACTION_MANAGER`. `obtenerBandeja` and `listarSolicitudesElegibles` MUST NOT — a structurally inspectable property (D13), the same technique already used 3 times in the repo.

#### Scenario: The two read use cases have no transaction manager injected

- GIVEN `ObtenerBandejaUseCase` and `ListarSolicitudesElegiblesUseCase`'s constructors
- WHEN their injected DI tokens are inspected
- THEN `TRANSACTION_MANAGER` does not appear among them

### Requirement: No DTO accepts companyId; the proactive recipient userId is the only client-supplied exception

`companyId` MUST always derive from `actor.companyId` — no request DTO in `ofertas` exposes it. `userId` for `aceptarOferta` and `obtenerBandeja` MUST always derive from `actor.profileId`. The single exception in the entire domain is `enviarOfertaProactiva`'s recipient `userId`, itself bounded by D10 (D11).

#### Scenario: No DTO in this domain exposes companyId

- GIVEN every HTTP DTO in `ofertas/adapters/http/`
- WHEN their fields are enumerated
- THEN none includes `companyId`

### Requirement: obtenerBandeja returns the user's own offers, with items inline

`obtenerBandeja()` MUST derive `userId` from `actor.profileId` and return only offers belonging to that user, each with its `items` populated inline — the reason `offer_items` is deliberately not published to Realtime (`db-schema-ofertas`).

#### Scenario: obtenerBandeja never returns another user's offers

- GIVEN user A and user B each have offers
- WHEN A calls `obtenerBandeja`
- THEN only A's offers are returned, never B's

#### Scenario: The bandeja includes items without a second request

- GIVEN user A has 2 offers, each with items
- WHEN A calls `obtenerBandeja`
- THEN both offers are returned, each with its `items` array populated, no additional call needed

### Requirement: OfertaEnviada and OfertaAceptada publish only after commit, with exactly the fields fixed by D6

`OfertaEnviada` (`'ofertas.oferta_enviada'`: `offerId`, `kind`, `companyId`, `userId`, `refillRequestId: string | null`, `total`, `tiempoEntregaHoras`) and `OfertaAceptada` (`'ofertas.oferta_aceptada'`: `offerId`, `companyId`, `userId`, `refillRequestId: string | null`, `total`, `desplazadas: readonly string[]` — the displaced offers' own ids) MUST publish only after their respective transaction commits — never inside it, never before. `refillRequestId: null` marks a proactive offer/acceptance on both events.

#### Scenario: A proactive OfertaEnviada carries refillRequestId: null

- GIVEN `enviarOfertaProactiva` succeeds
- WHEN `OfertaEnviada` publishes
- THEN its `refillRequestId` is `null`

#### Scenario: OfertaAceptada's desplazadas lists exactly the displaced offerIds

- GIVEN accepting offer B displaced siblings A and C
- WHEN `OfertaAceptada` publishes
- THEN `desplazadas` is `[A, C]` — exactly the offers this operation moved to `'rechazada'`, and nothing more

### Requirement: HTTP surface

Resolved here (Q5): `POST /ofertas` (`enviarOferta`), `POST /ofertas/proactivas` (`enviarOfertaProactiva`), `GET /ofertas/oportunidades` (`listarSolicitudesElegibles`) — all `@Roles('provider')`. `POST /ofertas/:offerId/aceptar` (`aceptarOferta`), `GET /ofertas/bandeja` (`obtenerBandeja`) — both `@Roles('user')`. No route for `registrarOportunidad` — internal, invoked only by the `MatchEncontrado` listener. No separate "mis ofertas enviadas" route is added: the provider's own sent offers are already readable directly against Postgres via the existing `offers_authenticated_select_provider` RLS policy (`db-schema-ofertas`), the same direct-read path `docs/ARCHITECTURE.md` reserves for logic-free reads — an equivalent core-api endpoint here would duplicate it without new business logic.

#### Scenario: Every route derives its actor-scoped id from the actor, never a body/path parameter

- GIVEN any of the 5 HTTP routes above
- WHEN a request is dispatched
- THEN `companyId`/`userId` (except the bounded proactive recipient) come from `actor.companyId`/`actor.profileId`, never from the request

### Requirement: A company may send more than one pending offer on the same solicitud

Provisional (Q6, pending product confirmation): the schema's only uniqueness constraint is on `'aceptada'` per `refillRequestId`; this change does NOT add an application-level restriction preventing the same company from sending multiple `'pendiente'` offers on the same solicitud — they coexist until one is accepted (displacing all `'pendiente'` siblings regardless of which company sent them). Tightening this to a reject-on-duplicate rule is a product decision deferred, not silently assumed.

#### Scenario: A second offer from the same company on the same solicitud is accepted, not rejected

- GIVEN company A already sent a `'pendiente'` offer on R
- WHEN A calls `enviarOferta(R, ...)` again before any offer on R is accepted
- THEN a second `'pendiente'` offer is created — no 409, no replacement of the first
