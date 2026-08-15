# Delta for shared-types-package

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
