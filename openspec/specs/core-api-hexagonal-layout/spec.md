# core-api-hexagonal-layout Specification

## Purpose

The per-domain folder convention and the cross-domain import boundary that the 5 placeholder domains copy from `identidad`, the reference implementation (R3).

## Requirements

### Requirement: Fixed per-domain folder shape

Every domain under `services/core-api/src/domains/<name>/` MUST contain exactly: `domain/` (entities/factories, zero framework imports), `ports-in/` (one class per use-case), `ports-out/` (interfaces + DI tokens), `contracts/` (present only when the domain exposes a sync query port or an implementation to another domain), `adapters/http|persistence|events`, and `<name>.module.ts`.

#### Scenario: identidad matches the reference shape

- GIVEN `services/core-api/src/domains/identidad/`
- WHEN its folder tree is inspected
- THEN it contains exactly `domain/`, `ports-in/`, `ports-out/`, `contracts/`, `adapters/{http,persistence,events}/`, `identidad.module.ts`

### Requirement: Only contracts/ is importable across a domain boundary

No file outside `domains/<name>/` — including the shared kernel and other domains — MUST import from `domains/<name>/ports-out/`, `domains/<name>/adapters/persistence/`, `domains/<name>/adapters/events/`, or `domains/<name>/domain/`. Only `domains/<name>/contracts/` MAY be imported cross-domain.

#### Scenario: A domain query port is consumed correctly

- GIVEN `ofertas` needs `catalogo`'s product price
- WHEN `ofertas` code is written
- THEN it imports `CatalogQueryPort` from `domains/catalogo/contracts/` and never reaches into `domains/catalogo/ports-out/` or `adapters/persistence/`

#### Scenario: identidad's ActorPort implementation is the reference pattern

- GIVEN `shared/auth` declares `ActorPort` and needs an implementation
- WHEN `IdentidadModule` binds `ACTOR_PORT` to `IdentidadActorAdapter`
- THEN `IdentidadActorAdapter` lives in `domains/identidad/contracts/`, and no file under `shared/auth/` imports from `domains/identidad`

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
