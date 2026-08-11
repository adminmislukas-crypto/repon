# shared-types-package Specification

## Purpose

`@repon/types` promotes `packages/types/SPEC.md`'s TS interface block to real, importable `.ts` code — the single source of entity shapes for `core-api`'s domain layer (D3).

## Requirements

### Requirement: @repon/types is a real, importable workspace package

`packages/types/src/**` MUST contain runnable `.ts` exporting every type/interface currently documented in `packages/types/SPEC.md`. `packages/types/SPEC.md` becomes documentation of the code, not the executable source.

#### Scenario: core-api imports without re-declaring

- GIVEN `services/core-api`'s domain layer needs the `Profile` shape
- WHEN it is used
- THEN it is imported from `@repon/types` — no domain file re-declares `interface Profile`

### Requirement: Validation rules documented in SPEC.md live in the type/DTO, not only the form

Rules listed under `packages/types/SPEC.md`'s "Reglas de validación" (e.g. `OfferItem.altNote` required when `isAlt`, `UserConsumption.horarios` non-empty, `CompanyStatus` starts `'pendiente'`, `ProfileStatus` starts `'activo'`) MUST be enforced at the type/DTO layer (branded types, `class-validator` decorators on the corresponding HTTP DTO, or a factory function) — not solely in client-side form validation.

#### Scenario: An invalid OfferItem is rejected at the boundary

- GIVEN `OfferItem.isAlt === true` and `altNote` absent
- WHEN the corresponding DTO is validated
- THEN the request is rejected before reaching domain logic

### Requirement: DB row types never enter @repon/types

Kysely-generated row types (`snake_case`, `src/shared/database/schema.ts` in `core-api`) MUST NOT be exported from `@repon/types`. `@repon/types` stays `camelCase` domain shapes only (D-A) — the adapter boundary is the only place the cast happens.

#### Scenario: schema.ts is not re-exported

- GIVEN `@repon/types`'s public exports
- WHEN they are enumerated
- THEN none originate from `shared/database/schema.ts`

### Requirement: catalogo upload types are added to @repon/types, with validation colocated in the type/DTO layer

`packages/types/src/catalogo.ts` MUST export three new canonical shapes (D12): `ArchivoCarga` (an already-parsed, framework-free representation of an uploaded catalog file — rows of raw column values, never an `Express.Multer.File` or any framework buffer type, per D11), `ResultadoCargaMasiva` (the per-row success/failure report returned by `cargarCatalogoMasivo`), and `NuevoProductoProveedor` (the input shape for a single product upload). None of the three MUST be re-declared inside `core-api`'s domain layer — `ports-in`/`domain` files import them from `@repon/types`. Field-level validation rules for these three shapes (e.g. non-negative prices, non-empty rows) MUST be enforced at the type/DTO layer in `core-api`'s `adapters/http/` (branded types or `class-validator` decorators on the corresponding DTO) — never solely inside the use case, and never solely as a DB constraint.

#### Scenario: catalogo imports without re-declaring

- GIVEN `services/core-api`'s `catalogo` domain layer needs the `ArchivoCarga` shape
- WHEN it is used
- THEN it is imported from `@repon/types` — no `ports-in`/`domain` file re-declares `interface ArchivoCarga`

#### Scenario: An invalid row is captured as an individual failure, not a thrown exception

- GIVEN an `ArchivoCarga` with a row whose `precioBase` fails the DTO-layer validation rule defined for `NuevoProductoProveedor`
- WHEN `cargarCatalogoMasivo` processes that row
- THEN the row-level validation rule (defined once in the type/DTO layer, not re-implemented in the use case) rejects it, the failure is recorded in `ResultadoCargaMasiva.fallos` for that row, and the remaining rows still process independently (D2)

### Requirement: UserConsumption gains a userId field, closing the asymmetry with Pet and matching db-schema-consumo's NOT NULL owner column

`packages/types/src/consumo.ts`'s `UserConsumption` interface MUST export `userId: string`, matching `Pet.userId` (already present) and `db-schema-consumo`'s `user_consumption.user_id NOT NULL` physical column, present regardless of `ownerType`. This field is what `core-api-consumo`'s D7 ownership-verification scenarios (`marcarDosisTomada`/`calcularDiasRestantes` cross-tenant checks) compare against — without it on the typed entity, that verification is not expressible (D15).

#### Scenario: UserConsumption carries an owner userId like Pet

- GIVEN `@repon/types`'s `UserConsumption` interface
- WHEN it is inspected
- THEN it exports `userId: string`, mirroring `Pet.userId`

#### Scenario: Ownership check is expressible directly on the loaded entity

- GIVEN a `UserConsumption` entity already loaded in memory (e.g. returned by `findById`)
- WHEN `consumo`'s D7 ownership check compares `entity.userId` against `actor.profileId`
- THEN the comparison is possible directly on the typed entity, with no additional repository call needed to fetch the owner
