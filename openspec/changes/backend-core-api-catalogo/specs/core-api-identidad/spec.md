# Delta for core-api-identidad

## ADDED Requirements

### Requirement: reactivarEmpresa reverses a suspension, audited in the same transaction

`reactivarEmpresa(companyId: string, adminId: string, motivo: string): Promise<void>` MUST mirror `suspenderEmpresa`'s transactional pattern exactly: it MUST run inside one `TransactionManager.runInTransaction` call, and MUST require the target company to currently have `status: 'suspendido'`. If the company does not exist, it MUST throw `CompanyNotFoundError` (404), the same as every other company-targeting use case in this domain. If the company exists but its `status` is not `'suspendido'` (e.g. `'activo'` or `'pendiente'`), it MUST throw `CompanyNotSuspendedError` before any write — mapped to HTTP 409 `COMPANY_NOT_SUSPENDED` in `adapters/http/`. On a valid transition it MUST set `companies.status` to `'activo'`, insert one `audit_log` row (`accion: 'reactivar_empresa'`, `entityType: 'company'`, `cambios: { status: { antes: 'suspendido', despues: 'activo' } }`, `motivo`) inside the same transaction, and publish `EmpresaReactivada(companyId, motivo)` after commit.

**Declared delta over `services/core-api/domains/identidad/SPEC.md`**: neither `reactivarEmpresa` nor `EmpresaReactivada` exist in the current product spec — today `identidad` has no use case transitioning `suspendido → activo` (D16, resolves proposal Q3). This is purely additive: no existing use case's signature or behavior changes.

#### Scenario: Admin reactivates a suspended company

- GIVEN a company with `status: 'suspendido'`
- WHEN an admin invokes `reactivarEmpresa(companyId, adminId, motivo)`
- THEN inside one transaction `companies.status` becomes `'activo'` and an `audit_log` row is inserted with `cambios: { status: { antes: 'suspendido', despues: 'activo' } }`, then `EmpresaReactivada` publishes after commit

#### Scenario: Reactivating a company that is not suspended fails without mutating

- GIVEN a company with `status: 'activo'` (or `'pendiente'`)
- WHEN `reactivarEmpresa(companyId, adminId, motivo)` is called
- THEN it throws `CompanyNotSuspendedError` (HTTP 409 `COMPANY_NOT_SUSPENDED`), no row is mutated, no `audit_log` entry is written, and `EmpresaReactivada` is not published

#### Scenario: Reactivating a nonexistent company is a 404, consistent with the rest of the domain

- GIVEN no company exists with the given `companyId`
- WHEN `reactivarEmpresa(companyId, adminId, motivo)` is called
- THEN it throws `CompanyNotFoundError` (404), the same error already used by `aprobarEmpresa`/`suspenderEmpresa` for a missing company

#### Scenario: A mutation failure rolls back its audit entry

- GIVEN the `UPDATE companies` statement inside `reactivarEmpresa` fails
- WHEN the transaction rolls back
- THEN no `audit_log` row exists for that attempt, mirroring the existing rollback guarantee already specified for `aprobarEmpresa`

### Requirement: reactivarEmpresa requires the same admin sub-role matrix as suspenderEmpresa

`reactivarEmpresa` MUST require `@AdminRoles('super_admin', 'soporte')` — the same day-to-day moderation matrix already required by `aprobarEmpresa`/`suspenderEmpresa`/`suspenderUsuario`. It is the 5th admin-mutating, audited use case in this domain.

#### Scenario: soporte can reactivate a company

- GIVEN an actor with `role: 'admin'`, `adminRole: 'soporte'`
- WHEN the HTTP route for `reactivarEmpresa` is called
- THEN the request is authorized and `reactivarEmpresa` executes

#### Scenario: The existing identidad test suite has no regression

- GIVEN the 111 unit + 17 e2e tests that existed before this change
- WHEN `reactivarEmpresa` is added
- THEN the full existing suite still passes unmodified — no existing use case's signature or behavior changed (R9)
