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
