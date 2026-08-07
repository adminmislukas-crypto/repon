# Delta for shared-types-package

## ADDED Requirements

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
