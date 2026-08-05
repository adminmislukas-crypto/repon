# core-api-identidad Specification

## Purpose

The `identidad` domain vertical: the 6 use cases already documented in `identidad/SPEC.md`, their corrected ports-out (this change closes 4 signature gaps the product `SPEC.md` left open), the ownership of the Auth-provisioning compensation saga, and audit-log-in-the-same-transaction for the 4 admin actions.

## Requirements

### Requirement: Ports-out carry a trailing optional transaction context

Every `ProfileRepository`, `CompanyRepository`, and `AdminRoleRepository` method MUST accept a trailing optional `tx?: TransactionContext` (the opaque handle from `shared/database`, D-A) as its last parameter. `AuthProvider` and `EventPublisher` MUST NOT gain a `tx?` parameter — neither participates in the SQL transaction (Auth is a separate system; events publish after commit).

```ts
interface ProfileRepository {
  insertIfAbsent(profile: Profile, tx?: TransactionContext): Promise<void> // ON CONFLICT (id) DO NOTHING
  update(profile: Profile, tx?: TransactionContext): Promise<void>
  findById(id: string, tx?: TransactionContext): Promise<Profile | null>
}
interface CompanyRepository {
  save(company: Company, tx?: TransactionContext): Promise<void>
  findById(id: string, tx?: TransactionContext): Promise<Company | null>
}
interface AdminRoleAssignment {
  id: string
  profileId: string
  rol: AdminRole
  grantedBy: string
  createdAt: string
}
interface AdminRoleRepository {
  upsert(assignment: AdminRoleAssignment, tx?: TransactionContext): Promise<void> // UNIQUE(profile_id): re-grant replaces the row
  findByProfileId(profileId: string, tx?: TransactionContext): Promise<AdminRoleAssignment | null>
}
export const ADMIN_ROLE_REPOSITORY = Symbol('ADMIN_ROLE_REPOSITORY')
```

`AdminRoleAssignment` is named distinctly from the `AdminRole` union type (`@repon/types`) to resolve the naming collision left by `identidad/SPEC.md`, which lists "AdminRole" as both an owned entity and (via `@repon/types`) a sub-role enum — this spec disambiguates rather than silently picking one.

`ProfileRepository.save` is REMOVED and replaced by `insertIfAbsent` + `update`: a single method cannot express "idempotent creation that never overwrites" (needed by the `registrarUsuario` compensation saga's retry safety) and "mutate an existing row" at once. `CompanyRepository.save` remains a single method — no compensation-retry requirement exists for `companies`, so the split does not apply there.

#### Scenario: Retry-safe profile creation

- GIVEN `registrarUsuario` retries after a partial failure and the `profiles` row already exists
- WHEN `insertIfAbsent` is called again with the same `id`
- THEN it resolves without error and does not overwrite the existing row

### Requirement: registrarUsuario owns the Auth-to-profiles compensation saga

`RegistrarUsuarioUseCase` — not the `AuthProvider` adapter — MUST orchestrate all 3 steps: (1) `AuthProvider.createAccount`, (2) `ProfileRepository.insertIfAbsent`, (3) `EventPublisher.publish(UsuarioRegistrado)`. `AuthProvider`'s only added responsibility is classifying step-1 failures as `AuthProviderDeterministicError` (`reason: 'email_taken' | 'invalid_credentials' | 'other'`) or `AuthProviderAmbiguousError`; it never touches `ProfileRepository`.

#### Scenario: Success publishes the event

- GIVEN valid `RegistroUsuario` data
- WHEN `registrarUsuario` runs
- THEN `createAccount` succeeds, `insertIfAbsent` succeeds, `UsuarioRegistrado` is published, and a `Profile` is returned (201)

#### Scenario: Deterministic failure on profiles compensates with a delete

- GIVEN `createAccount` succeeded (uid U) and `insertIfAbsent` then throws any error (constraint, network, DB timeout with a clear failure response)
- WHEN the use case handles the failure
- THEN it calls `AuthProvider.deleteAccount(U)` — `ON DELETE RESTRICT` guarantees this only succeeds if no `profiles` row exists for U — then throws a 503 registration error; it does NOT retry, and an orphaned `deleteAccount` failure is left for `v_auth_orphans` to detect, never auto-retried

#### Scenario: Ambiguous Auth failure recovers forward, never deletes

- GIVEN `createAccount` throws `AuthProviderAmbiguousError` (timeout/5xx — unknown whether the account was created)
- WHEN the use case handles the failure
- THEN it calls `findAccountByEmail(email)`; if `null`, it throws a 503 registration error (clean, retryable, `deleteAccount` never called); if an account is found, it re-attempts `insertIfAbsent` using that account's id

#### Scenario: Deterministic Auth failure needs no compensation

- GIVEN `createAccount` throws `AuthProviderDeterministicError(reason: 'email_taken')`
- WHEN the use case handles the failure
- THEN no compensation runs (no account was ever created) and the use case responds 409; any other deterministic reason responds 502

### Requirement: registrarEmpresa creates only the company row

`registrarEmpresa(datos: RegistroEmpresa): Promise<Company>` MUST perform exactly one `INSERT` into `companies` (`status: 'pendiente'`) and MUST NOT touch `profiles`. It never writes `audit_log` — no admin actor exists at this point, this is self-service.

#### Scenario: A provider registers their company first, then their own profile

- GIVEN a prospective provider with no account yet
- WHEN they call `registrarEmpresa` (business data only) and receive `{ id: companyId, status: 'pendiente' }`
- THEN they call `registrarUsuario` with `role: 'provider'` and `companyId` set to that id in the same request payload, so the single `profiles` insert already satisfies the `role: 'provider' ⇒ companyId not null` invariant — no second use case is needed to link them

### Requirement: Admin mutations audit inside the same transaction

`aprobarEmpresa`, `suspenderUsuario`, and `suspenderEmpresa` MUST run their row mutation and `AuditLogPort.record` inside one `TransactionManager.runInTransaction` call, passing the same `tx` to both. `cambios` MUST use the shape `{ campo: { antes, despues } }`. The corresponding domain event publishes only after the transaction commits.

#### Scenario: aprobarEmpresa mutates and audits atomically

- GIVEN a company in `status: 'pendiente'` and an authenticated admin actor
- WHEN `aprobarEmpresa(companyId, adminId)` runs
- THEN inside one transaction `companies.status` becomes `'activo'` and an `audit_log` row is inserted (`accion: 'aprobar_empresa'`, `entityType: 'company'`, `cambios: { status: { antes: 'pendiente', despues: 'activo' } }`), then `EmpresaAprobada` publishes after commit

#### Scenario: suspenderUsuario / suspenderEmpresa mirror the same pattern

- GIVEN a valid target and a `motivo`
- WHEN `suspenderUsuario(profileId, adminId, motivo)` or `suspenderEmpresa(companyId, adminId, motivo)` runs
- THEN the row's `status` becomes `'suspendido'` and an `audit_log` row is inserted in the same transaction with `motivo` carried through; the corresponding event publishes after commit

#### Scenario: A mutation failure rolls back its audit entry

- GIVEN the `UPDATE companies` statement inside `aprobarEmpresa` fails
- WHEN the transaction rolls back
- THEN no `audit_log` row exists for that attempt

### Requirement: asignarRolAdmin requires the granting admin's id

`asignarRolAdmin(profileId: string, rol: AdminRole, adminId: string): Promise<void>` MUST pass `adminId` as `admin_roles.granted_by` (`NOT NULL`). It MUST call `AdminRoleRepository.upsert` (re-grant replaces the existing row per `UNIQUE(profile_id)`) and `AuditLogPort.record` inside the same transaction.

#### Scenario: Re-assigning a sub-role replaces, not duplicates

- GIVEN profile P already has an `admin_roles` row with `rol: 'soporte'`
- WHEN `asignarRolAdmin(P, 'finanzas', adminId)` runs
- THEN P's single `admin_roles` row now has `rol: 'finanzas'`, `granted_by: adminId`, and exactly one new `audit_log` entry exists for the change

### Requirement: Admin sub-role matrix per route

`aprobarEmpresa`, `suspenderEmpresa`, and `suspenderUsuario` MUST require `@AdminRoles('super_admin', 'soporte')` — day-to-day moderation. `asignarRolAdmin` MUST require `@AdminRoles('super_admin')` only, since granting a sub-role is privilege escalation. No route in this change accepts `finanzas` — no current use case requires it.

#### Scenario: soporte can approve a company

- GIVEN an actor with `role: 'admin'`, `adminRole: 'soporte'`
- WHEN `POST /identidad/empresas/:id/aprobacion` is called
- THEN the request is authorized and `aprobarEmpresa` executes

#### Scenario: soporte cannot assign admin roles

- GIVEN an actor with `adminRole: 'soporte'`
- WHEN `PUT /identidad/usuarios/:id/rol-admin` is called
- THEN it responds 403 `ADMIN_SUBROLE_NOT_ALLOWED`

### Requirement: company_dispatch_zones is out of scope for this change

No `identidad` use case, controller route, or repository in this change MUST create, read, or update `company_dispatch_zones`. This is a stated scope boundary, not a silent omission: none of the 6 documented use cases write dispatch zones, and the table belongs to matching (`catalogo` or a future dedicated use case), not identity.

#### Scenario: No route touches dispatch zones

- GIVEN the full `identidad` HTTP surface after this change
- WHEN its routes are enumerated
- THEN none reference `company_dispatch_zones`
