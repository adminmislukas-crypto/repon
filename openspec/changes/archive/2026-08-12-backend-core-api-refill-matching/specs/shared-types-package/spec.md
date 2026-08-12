# Delta for shared-types-package

## ADDED Requirements

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
