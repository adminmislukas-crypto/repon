# usuario-mobile-consumo Specification

## Purpose

The `usuario-mobile` consumption-tracking surface: today's-doses view (self and pet owners), dose marking against `core-api-consumo`'s write route, create flows for self- and pet-owned items across all four `kind` values, a read-only actives list, a 7-day adherence/history view, and the `authFetch` JSON-body/error-mapping convention this feature establishes as the first non-auth consumer. Screen layout, composite-vs-separate fetch shape, optimistic-vs-refetch UI, empty/first-run copy, and owner-tab structure are `sdd-design`'s job — this spec fixes only observable behavior. Out of scope: update/reconfigure of a pet or consumption (D4), Zustand/TanStack Query/NativeWind (D2).

## Requirements

### Requirement: Today's-doses view shows real, server-sourced data for the signed-in user and each of their pets

`s-consumo` MUST render today's due items sourced from the caller's own pets and consumptions via `core-api-consumo`'s list reads, MUST let the user switch between their own items and each owned pet's items, and MUST show each item's server-computed `diasRestantes` without deriving it locally.

#### Scenario: Self items and a pet's items are both reachable from one screen

- GIVEN a signed-in user with a self-owned consumption and a pet with a pet-owned consumption
- WHEN the user opens `s-consumo` and switches between self and that pet
- THEN each view shows only the items owned by the selected owner, sourced from the server

#### Scenario: Days-remaining shown matches what the server returned

- GIVEN a consumption item with a server-computed `diasRestantes` value V
- WHEN `s-consumo` renders that item
- THEN the displayed days-remaining figure equals V, with no client-side recomputation of the formula

### Requirement: Marking a dose calls the real endpoint and reflects persisted state

Marking a dose MUST call `POST /consumo/mis-consumos/:id/dosis` — no client-side-only simulation. After a successful mark, the UI MUST reflect state consistent with what the server persisted for that item.

#### Scenario: A successful mark persists across a screen reload

- GIVEN an item not yet marked done today
- WHEN the user marks its dose and the request succeeds
- THEN reopening or refreshing the screen shows the item's post-mark state as returned by the server

### Requirement: A failed dose-mark fails visibly with manual retry, never silently

When `POST .../dosis` fails (network error or non-2xx response), the UI MUST show a visible failure indication for that item and MUST offer a manual retry action. The system MUST NOT queue the mark for silent background retry and MUST NOT show the item as done unless the server confirmed it (Q6).

#### Scenario: A network failure while marking shows a visible error, not a silent success

- GIVEN the device is offline or the request fails
- WHEN the user marks a dose
- THEN the item is not shown as done, a visible error state appears, and the user can retry manually

### Requirement: Create flows collect real, kind-specific fields for every consumption kind, including vacuna

Both create screens (`s-consumo-nuevo` for self, `s-consumo-nuevo-pet` for a pet) MUST collect values sufficient to satisfy `NuevoConsumoDto` for whichever `kind` is selected (`medicamento`, `alimento`, `vacuna`, `suplemento`). For `kind: 'vacuna'`, the form MUST collect a real `horarios` schedule and a real `stockActual` — no synthesized or default value MUST be submitted for either field (Q1). `suplemento` MUST reuse `medicamento`'s field block (D5).

#### Scenario: A vacuna item submits a real schedule and stock, not defaults

- GIVEN the user selects `kind: 'vacuna'` on a pet create flow and fills the form
- WHEN the form is submitted
- THEN the request body's `horarios` and `stockActual` reflect values the user entered, not synthesized/placeholder values

#### Scenario: All four kinds produce an acceptable payload

- GIVEN the user completes a create flow for each of `medicamento`, `alimento`, `vacuna`, `suplemento`
- WHEN each is submitted
- THEN each request satisfies `NuevoConsumoDto`'s required fields for that `kind`

### Requirement: The config list is read-only; no interaction creates a duplicate item

`s-consumo-config` MUST list the caller's active items (self and pet-owned) without exposing any action that submits a new create request for an already-existing item. Any "editar"-style affordance shown MUST NOT route into a create form for that item and MUST NOT be capable of producing a second, duplicate active item for the same logical consumption (D4).

#### Scenario: Viewing config never triggers a create request

- GIVEN the user opens `s-consumo-config` with existing active items
- WHEN the user interacts with any item shown on this screen
- THEN no `POST /consumo/mis-consumos` request is made as a result

### Requirement: The history view shows server-computed 7-day adherence, never client-derived

`s-consumo-historial` MUST render adherence/history data as returned by `core-api-consumo`'s 7-day read, bounded to that window. The client MUST NOT compute adherence, streaks, or percentages from raw logs itself (D6).

#### Scenario: History reflects exactly the server's 7-day figures

- GIVEN the server returns adherence data for the trailing 7 days
- WHEN `s-consumo-historial` renders it
- THEN the figures shown equal the server's values with no local recomputation

### Requirement: Every screen has distinct loading, empty, and error states

Each of the 5 screens MUST render a distinct loading state while its data fetch is in flight, a distinct empty state when the relevant collection has zero items, and a distinct error state when a request fails. The three MUST be visually/textually distinguishable from each other and from the populated state.

#### Scenario: A zero-item response renders an empty state, not a blank or error screen

- GIVEN a screen's underlying read returns an empty collection
- WHEN the screen finishes loading
- THEN an explicit empty state renders, distinct from both the loading and error states

#### Scenario: A failed read renders a distinct error state

- GIVEN a screen's underlying read fails
- WHEN the screen finishes attempting to load
- THEN a distinct error state renders, not the loading spinner and not an empty-state message

### Requirement: authFetch calls use a shared JSON-body and Spanish error-mapping convention

Every POST made through `authFetch` in this feature MUST set `Content-Type: application/json` and JSON-stringify the body via one shared helper, not per-screen ad hoc code. Every non-2xx response MUST be mapped from the `{statusCode, code, message}` error envelope to a distinct Spanish-language message per `code`, via that same shared helper — no screen MUST hand-roll its own error-code-to-text mapping.

#### Scenario: A known error code maps to a distinct Spanish message

- GIVEN a POST request returns a non-2xx response with a known `code` (e.g. `PET_NOT_FOUND`, `CONSUMO_INVALIDO`, `DOSIS_INVALIDA`)
- WHEN the shared helper processes the response
- THEN the resulting UI message is in Spanish and distinguishable from the message shown for a different `code`

#### Scenario: Two screens handle the same error code identically

- GIVEN the same error `code` is returned to two different screens' POST calls
- WHEN each screen displays its error state
- THEN both use the message produced by the same shared helper, not independently written text
