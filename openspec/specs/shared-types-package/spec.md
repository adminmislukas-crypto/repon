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

### Requirement: Urgencia and RefillEstado are named, exported types, and RefillEstado gains 'borrador'

`packages/types/src/refill-matching.ts` MUST export `Urgencia` and `RefillEstado` as named types (previously inline unions on `RefillRequest.urgencia`/`RefillRequest.estado`), and `RefillEstado` MUST include `'borrador'` as a fourth value, alongside the existing `'abierta'`/`'ofertada'`/`'confirmada'` (D3, D11).

#### Scenario: Urgencia and RefillEstado are importable independently of RefillRequest

- GIVEN `@repon/types`'s public exports
- WHEN `Urgencia` and `RefillEstado` are imported
- THEN both resolve to named types, not only as inline members of `RefillRequest`

#### Scenario: RefillEstado includes borrador

- GIVEN `RefillEstado`
- WHEN its members are enumerated
- THEN they are exactly `'borrador' | 'abierta' | 'ofertada' | 'confirmada'`

### Requirement: RefillRequest becomes a discriminated union on estado — borrador variant vs. active variant; RefillItem keeps its exact shape

Mirroring `Offer`/`OfferItem`'s `?: never` discriminated-union pattern in `ofertas.ts` (`OfferItemReactiva`/`OfferItemProactiva`) — not a newly invented shape — `RefillRequest` MUST discriminate on `estado`: a `'borrador'` variant where `direccion`, `comuna`, and items are `RefillItemBorrador` (with `categoria`/`precioReferencia` optional), and an active variant (`estado: 'abierta' | 'ofertada' | 'confirmada'`) where `direccion`/`comuna` are required and items are the existing `RefillItem` (design.md D-B). **`RefillItem` itself MUST NOT change shape** — it remains exactly as already typed today. `catalogo`'s `CatalogQueryPort.buscarCoincidencias(itemsSolicitados: RefillItem[], companyId?)` is a frozen cross-domain contract (C1–C8); widening `RefillItem` into a union would stop `KyselyCatalogQueryAdapter` from compiling, violating this change's own success criterion that `catalogo` is not modified anywhere. `RefillItemBorrador` is instead a new, separate sibling type used only by the `'borrador'` variant of `RefillRequest`.

#### Scenario: A borrador RefillRequest type-checks with direccion/comuna omitted

- GIVEN the `'borrador'`-discriminated variant of `RefillRequest`
- WHEN a value with `estado: 'borrador'` and no `direccion`/`comuna` is constructed
- THEN it type-checks

#### Scenario: An active RefillRequest requires direccion, comuna, and item completeness

- GIVEN the active-discriminated variant of `RefillRequest` (`estado: 'abierta' | 'ofertada' | 'confirmada'`)
- WHEN a value is constructed omitting `direccion`, `comuna`, or an item's `categoria`/`precioReferencia`
- THEN it fails to type-check

#### Scenario: A borrador's items are never assignable where RefillItem[] is expected

- GIVEN a `'borrador'`-variant `RefillRequest.items: RefillItemBorrador[]`
- WHEN it is passed where `CatalogQueryPort.buscarCoincidencias(itemsSolicitados: RefillItem[], ...)` expects `RefillItem[]`
- THEN it fails to type-check — "a draft never enters matching" is a compile error, not only a runtime check

### Requirement: NuevoRefillItem is added as crearSolicitud's item input type

`packages/types/src/refill-matching.ts` MUST export `NuevoRefillItem`, the input shape `crearSolicitud(userId, items: NuevoRefillItem[], direccion, comuna, urgencia)` accepts — the raw `refill-matching/SPEC.md` signature already references `NuevoRefillItem[]` without the type existing in the package. No `NuevoRefillSolicitud` wrapper type MUST be added; `crearSolicitud` keeps discrete scalar parameters, matching every existing `catalogo`/`consumo` use case signature (D11, D12).

#### Scenario: crearSolicitud's items parameter is typed with NuevoRefillItem

- GIVEN `@repon/types`'s exports
- WHEN `NuevoRefillItem` is imported
- THEN it resolves to a named type, and no `NuevoRefillSolicitud` wrapper type exists

## ADDED Requirements

### Requirement: NuevoOfferItem is added as the input shape for enviarOferta/enviarOfertaProactiva's items

`packages/types/src/ofertas.ts` MUST export `NuevoOfferItem`, mirroring `OfferItem`'s `OfferItemReactiva`/`OfferItemProactiva` discriminated-union pattern with `?: never` on the excluded discriminant — not a newly invented shape (D14). It is kept as a distinct named type from `OfferItem` for input/DTO clarity, even though its fields are structurally identical today.

#### Scenario: NuevoOfferItem discriminates exactly like OfferItem

- GIVEN `NuevoOfferItem`
- WHEN a value sets both `refillItemId` and `providerCatalogItemId`, or neither
- THEN it fails to type-check, mirroring `OfferItemReactiva`/`OfferItemProactiva`

#### Scenario: enviarOferta's items are typed with NuevoOfferItem

- GIVEN `@repon/types`'s exports
- WHEN `NuevoOfferItem` is imported
- THEN it resolves to a named type usable as `enviarOferta`/`enviarOfertaProactiva`'s `items` parameter

### Requirement: DatosEntrega is added, and closes a gap in enviarOfertaProactiva's raw signature

`packages/types/src/ofertas.ts` MUST export `DatosEntrega` (`{ tiempoEntregaHoras: number; costoDespacho: number }`) — the two `Offer` fields no other parameter supplies (D14). **Gap found and closed here**: `ofertas/SPEC.md`'s raw `enviarOfertaProactiva(companyId, userId, items, mensaje?)` signature has no way to populate `Offer.tiempoEntregaHoras`/`costoDespacho`, which are required on every offer regardless of `kind` — the same class of gap `db-schema-ofertas` already found and closed for `OfferItem.refillItemId`. Resolution: both `enviarOferta` and `enviarOfertaProactiva` accept `entrega: DatosEntrega`; `mensaje?` remains `enviarOfertaProactiva`'s own separate optional parameter, not folded into `DatosEntrega`.

#### Scenario: enviarOfertaProactiva accepts entrega, closing the raw-signature gap

- GIVEN `enviarOfertaProactiva`'s use case signature
- WHEN it is inspected
- THEN it accepts an `entrega: DatosEntrega` parameter — without it, `Offer.tiempoEntregaHoras`/`costoDespacho` would be unconstructable for a proactive offer

#### Scenario: DatosEntrega supplies both offers' delivery fields

- GIVEN `DatosEntrega`
- WHEN it is inspected
- THEN it exports exactly `tiempoEntregaHoras: number` and `costoDespacho: number`

### Requirement: SolicitudElegible is added as listarSolicitudesElegibles's output shape

`packages/types/src/ofertas.ts` MUST export `SolicitudElegible` (D14), mirroring `offer_opportunities`/`offer_opportunity_items`'s columns: `refillRequestId: string`, `comuna: string`, `urgencia: Urgencia` (reused from `refill-matching.ts`, never re-declared), `matchedAt: string`, `items: SolicitudElegibleItem[]` where each item carries `refillItemId`, `nombre`, `categoria`, `precioReferencia: number`, `catalogProductId?: string`.

#### Scenario: SolicitudElegible reuses Urgencia rather than re-declaring it

- GIVEN `SolicitudElegible.urgencia`
- WHEN its type is inspected
- THEN it is `Urgencia`, imported from `refill-matching.ts` — no second `Urgencia`-shaped union is declared in `ofertas.ts`

#### Scenario: listarSolicitudesElegibles returns SolicitudElegible[]

- GIVEN `@repon/types`'s exports
- WHEN `SolicitudElegible` is imported
- THEN it resolves to a named type matching `listarSolicitudesElegibles`'s return shape, with no re-declaration inside `core-api`'s domain layer
