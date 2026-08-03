# db-schema-identidad Specification

## Purpose

Companies (proveedores), their dispatch zones, user/provider/admin profiles, and admin role assignments. Source-of-truth domain per `identidad/SPEC.md` — no other domain writes these tables directly.

## Schema

### companies (newly finalized)

| Column | Type | Constraint |
|---|---|---|
| id | uuid | PK default `gen_random_uuid()` |
| razon_social | text | NOT NULL |
| rut | text | NOT NULL, UNIQUE |
| giro | text | NOT NULL |
| status | company_status | NOT NULL DEFAULT `'pendiente'` |
| created_at / updated_at | timestamptz | NOT NULL DEFAULT `now()` |

`company_status` enum: `'pendiente' | 'activo' | 'suspendido'`. `companies.rating` is explicitly OUT of scope — no column, per proposal.

### company_dispatch_zones (new table, Q2)

| Column | Type | Constraint |
|---|---|---|
| id | uuid | PK |
| company_id | uuid | NOT NULL REFERENCES companies(id) |
| comuna | text | NOT NULL |
| region | text | NOT NULL |
| — | — | UNIQUE(company_id, comuna) |

### profiles (fields fixed by `packages/types/SPEC.md`; physical-only additions)

Adds: `id` REFERENCES `auth.users(id)` (same UUID — see `auth-provisioning`); `company_id` uuid NULL REFERENCES `companies(id)` (only when `role = 'provider'`); `created_at`/`updated_at`.

### admin_roles (newly finalized)

| Column | Type | Constraint |
|---|---|---|
| id | uuid | PK |
| profile_id | uuid | NOT NULL UNIQUE REFERENCES profiles(id) |
| rol | admin_role | NOT NULL |
| granted_by | uuid | NOT NULL REFERENCES profiles(id) |
| created_at | timestamptz | NOT NULL DEFAULT `now()` |

`admin_role` enum: `'super_admin' | 'soporte' | 'finanzas'`. UNIQUE `profile_id` matches "un sub-rol por admin" — re-assigning replaces the row.

## Requirements

### Requirement: Company starts pending and approval is not a client-side status update

`companies.status` MUST default to `'pendiente'` on insert. `aprobarEmpresa` MUST be core-api-only (service-role) — no client-side UPDATE policy exists for `companies.status`.

#### Scenario: New company is invisible to the public marketplace until approved

- GIVEN a company is registered via `registrarEmpresa` with status `'pendiente'`
- WHEN an unaffiliated authenticated user queries `companies` directly
- THEN the row is not returned

### Requirement: SELECT allowlist for companies and dispatch zones

The system MUST allow `authenticated` SELECT on `companies` WHERE `status = 'activo'` (public directory), plus the owning provider's own company row regardless of status via `EXISTS (SELECT 1 FROM profiles p WHERE p.id = auth.uid() AND p.company_id = companies.id)`. `company_dispatch_zones` inherits the same visibility as its parent `companies` row.

#### Scenario: Public sees only active companies

- GIVEN companies A (`activo`) and B (`pendiente`)
- WHEN an authenticated user with no relation to B queries `companies`
- THEN only A is returned

#### Scenario: Owner sees their own pending company

- GIVEN company B is `pendiente` and profile P has `company_id = B.id`
- WHEN P queries `companies`
- THEN B is returned to P

### Requirement: profiles has no client-side mutation policy

(Flags a conflict) `supabase/SPEC.md` currently states "cada usuario ve y edita solo su propia fila" — superseded by D1: profile mutations (e.g. `suspenderUsuario`) MUST go through core-api with the service-role key. Only a SELECT policy for the owner exists.

#### Scenario: Owner reads own profile only

- GIVEN profile P with `id = auth.uid()`
- WHEN P queries `profiles`
- THEN only P's own row is returned

#### Scenario: Direct profile edit is rejected

- GIVEN an authenticated client
- WHEN it attempts `UPDATE profiles SET status = 'suspendido' WHERE id = auth.uid()` directly
- THEN Postgres rejects it — no UPDATE policy exists

### Requirement: admin_roles has no client access; bootstrap self-grant is the sole FK exception

`admin_roles` MUST NOT have any SELECT/INSERT/UPDATE/DELETE policy for `anon`/`authenticated` (admin-web reads via core-api service-role only). `granted_by` MUST reference an existing `profiles` row; the sole exception is the manual bootstrap seed (Q5), where the first `super_admin`'s `granted_by` is self-referential.

#### Scenario: No client access to admin_roles

- GIVEN any `authenticated` or `anon` role
- WHEN it queries `admin_roles` directly
- THEN zero rows are returned

#### Scenario: Bootstrap self-grant is valid

- GIVEN the first admin profile P is being seeded
- WHEN the seed inserts `admin_roles(profile_id = P.id, rol = 'super_admin', granted_by = P.id)`
- THEN the FK constraint is satisfied because P already exists in `profiles`
