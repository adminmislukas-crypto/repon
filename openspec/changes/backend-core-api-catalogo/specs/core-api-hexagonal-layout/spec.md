# Delta for core-api-hexagonal-layout

## MODIFIED Requirements

### Requirement: Fixed per-domain folder shape

Every domain under `services/core-api/src/domains/<name>/` MUST contain exactly: `domain/` (entities/factories, zero framework imports), `ports-in/` (one class per use-case), `ports-out/` (interfaces + DI tokens), `contracts/` (present only when the domain exposes a sync query port or an implementation to another domain), `adapters/http|persistence|events`, and `<name>.module.ts`. `adapters/events/` MUST be present whenever the domain subscribes to at least one domain event via an `@OnEvent` listener; it MAY be omitted when the domain only publishes events and never subscribes to any (D9). This closes WARNING-2 formally, not only in practice.

(Previously: listed `adapters/http|persistence|events` as always part of the fixed shape, with no explicit rule for when `adapters/events/` is mandatory versus omissible. `catalogo` is the first domain to actually populate `adapters/events/`.)

#### Scenario: identidad matches the reference shape, without adapters/events (publish-only)

- GIVEN `services/core-api/src/domains/identidad/`
- WHEN its folder tree is inspected
- THEN it contains exactly `domain/`, `ports-in/`, `ports-out/`, `contracts/`, `adapters/{http,persistence}/`, `identidad.module.ts` — no `adapters/events/`, because `identidad` only publishes events and never subscribes to one (D9)

#### Scenario: catalogo has adapters/events because it consumes events

- GIVEN `services/core-api/src/domains/catalogo/` after this change
- WHEN its folder tree is inspected
- THEN it contains `adapters/events/` with a listener subscribing to `EmpresaSuspendida`/`EmpresaAprobada`/`EmpresaReactivada` — required because `catalogo` consumes events, unlike `identidad`

### Requirement: Only contracts/ is importable across a domain boundary

No file outside `domains/<name>/` — including the shared kernel and other domains — MUST import from `domains/<name>/ports-out/`, `domains/<name>/adapters/persistence/`, `domains/<name>/adapters/events/`, or `domains/<name>/domain/`. Only `domains/<name>/contracts/` MAY be imported cross-domain.

When a domain OWNS a cross-domain interface — it declares the interface itself, rather than implementing one declared by the shared kernel — e.g. `catalogo`'s `CatalogQueryPort`, the interface and its DI token MUST live in `contracts/`, and the concrete class implementing it MUST live in `adapters/persistence/`, never exported from `contracts/` (D1). This differs from the kernel-declared case (`ActorPort`/`IdentidadActorAdapter`): there the domain only provides the adapter for a kernel-owned interface, and that adapter MAY live in `contracts/` directly, since `contracts/` there exports the binding to a kernel-owned contract, not a domain-owned one.

(Previously: established that only `contracts/` is cross-domain-importable, without distinguishing where the concrete implementation class of a domain-owned interface must live. `CatalogQueryPort` is the first domain-owned cross-domain interface in the repo, making this the first case this distinction actually governs.)

#### Scenario: A domain query port is consumed correctly

- GIVEN `ofertas` needs `catalogo`'s product price
- WHEN `ofertas` code is written
- THEN it imports `CatalogQueryPort` from `domains/catalogo/contracts/` and never reaches into `domains/catalogo/ports-out/` or `adapters/persistence/`

#### Scenario: identidad's ActorPort implementation is the reference pattern for a kernel-declared interface

- GIVEN `shared/auth` declares `ActorPort` and needs an implementation
- WHEN `IdentidadModule` binds `ACTOR_PORT` to `IdentidadActorAdapter`
- THEN `IdentidadActorAdapter` lives in `domains/identidad/contracts/`, and no file under `shared/auth/` imports from `domains/identidad`

#### Scenario: CatalogQueryPort's concrete implementation lives in adapters/persistence, not contracts

- GIVEN `catalogo` implements `CatalogQueryPort` with a Kysely-backed class
- WHEN the implementation is placed
- THEN the class lives in `domains/catalogo/adapters/persistence/`; `contracts/` exports only the `CatalogQueryPort` interface and the `CATALOG_QUERY_PORT` token, and no file imports the concrete class from outside `catalogo`
