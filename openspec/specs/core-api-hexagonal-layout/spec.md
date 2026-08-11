# core-api-hexagonal-layout Specification

## Purpose

The per-domain folder convention and the cross-domain import boundary that the 5 placeholder domains copy from `identidad`, the reference implementation (R3).

## Requirements

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

### Requirement: The boundary is CI-enforced, not only reviewed

Lint config MUST include an automated check (e.g. ESLint `no-restricted-imports` / `import/no-restricted-paths`) that fails the build on a disallowed cross-domain import path, in addition to code review. Nx boundary tags remain explicitly out of scope (D1).

#### Scenario: A disallowed deep import fails lint

- GIVEN a file in `domains/ofertas/` imports from `domains/catalogo/adapters/persistence/kysely-catalog.repository`
- WHEN lint runs
- THEN it fails and CI reports the violation

### Requirement: DTOs and framework decorators stay in adapters/http

`domain/`, `ports-in/`, and `ports-out/` MUST NOT import `@nestjs/swagger`, `class-validator`, or any HTTP-framework type. DTOs and `@ApiProperty` live only in `adapters/http/`; a mapper converts DTO ↔ port arguments and domain entity ↔ response DTO.

#### Scenario: A use case receives plain arguments, not a DTO

- GIVEN `RegistrarUsuarioUseCase.execute(cmd: RegistroUsuario)`
- WHEN its signature is inspected
- THEN `RegistroUsuario` is a plain domain/`@repon/types`-derived shape with no `class-validator` decorators
