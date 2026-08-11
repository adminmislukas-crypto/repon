# Delta for shared-types-package

## ADDED Requirements

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
