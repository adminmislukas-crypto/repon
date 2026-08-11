# Delta for core-api-hexagonal-layout

## MODIFIED Requirements

### Requirement: Fixed per-domain folder shape

Every domain under `services/core-api/src/domains/<name>/` MUST contain exactly: `domain/` (entities/factories, zero framework imports), `ports-in/` (one class per use-case), `ports-out/` (interfaces + DI tokens), `contracts/` (present only when the domain exposes a sync query port or an implementation to another domain), `adapters/http|persistence|events|scheduling`, and `<name>.module.ts`. `adapters/events/` MUST be present whenever the domain subscribes to at least one domain event via an `@OnEvent` listener; it MAY be omitted when the domain only publishes events and never subscribes to any (D9 of `catalogo`). `adapters/scheduling/` MUST be present whenever the domain registers at least one scheduled job (`@Cron()`); it MUST be omitted when the domain has no scheduled job (D1 of `consumo`). This closes WARNING-2 formally, not only in practice.

(Previously: fixed `adapters/http|persistence|events`, with `adapters/events/` conditional on event subscription and no rule at all for scheduling. `consumo` is the first domain to register a scheduled job.)

#### Scenario: identidad matches the reference shape, without adapters/events (publish-only)

- GIVEN `services/core-api/src/domains/identidad/`
- WHEN its folder tree is inspected
- THEN it contains exactly `domain/`, `ports-in/`, `ports-out/`, `contracts/`, `adapters/{http,persistence}/`, `identidad.module.ts` — no `adapters/events/`, because `identidad` only publishes events and never subscribes to one (D9)

#### Scenario: catalogo has adapters/events because it consumes events

- GIVEN `services/core-api/src/domains/catalogo/` after that change
- WHEN its folder tree is inspected
- THEN it contains `adapters/events/` with a listener subscribing to `EmpresaSuspendida`/`EmpresaAprobada`/`EmpresaReactivada` — required because `catalogo` consumes events, unlike `identidad`

#### Scenario: consumo has adapters/scheduling because it registers a cron job

- GIVEN `services/core-api/src/domains/consumo/` after this change
- WHEN its folder tree is inspected
- THEN it contains `adapters/scheduling/` with a single `@Cron()` class calling exactly one `ports-in` use case — required because `consumo` registers the repo's first scheduled job (D1)

#### Scenario: A domain with no scheduled job has no adapters/scheduling folder

- GIVEN `identidad` and `catalogo`, neither of which registers a scheduled job
- WHEN their folder trees are inspected
- THEN neither contains `adapters/scheduling/` — its absence is the correct, non-exceptional shape for a domain without a cron job
