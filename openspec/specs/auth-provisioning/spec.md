# auth-provisioning Specification

## Purpose

The relationship between Supabase Auth (`auth.users`) and `profiles`, the compensation flow for partial provisioning failures, orphan reconciliation, and the manual bootstrap runbook for the first `super_admin` (Q5).

## Requirements

### Requirement: profiles.id mirrors auth.users.id

`profiles.id` MUST equal the corresponding `auth.users.id` (same UUID) and MUST be declared as a foreign key to `auth.users(id)`. No separate `user_id` column is needed since identity is shared.

#### Scenario: Profile creation always follows an Auth account

- GIVEN an Auth account with id U is created via `AuthProvider.createAccount`
- WHEN `registrarUsuario` inserts into `profiles`
- THEN the new row uses `id = U`, satisfying the FK to `auth.users`

### Requirement: Compensating delete on partial provisioning failure

If `AuthProvider.createAccount` succeeds but the subsequent `profiles` insert fails (e.g. constraint violation), the system MUST delete the just-created `auth.users` row as a compensating action, since there is no shared transaction across the two systems (R5).

#### Scenario: profiles insert fails after Auth account creation

- GIVEN an Auth account U was just created
- WHEN the `profiles` insert for U fails
- THEN the system deletes Auth account U
- AND no orphaned Auth account remains for that registration attempt

### Requirement: Orphan reconciliation for accounts that outlive their failed compensation

A reconciliation job MUST exist that finds `auth.users` rows older than a fixed threshold (e.g. 15 minutes) with no matching `profiles` row, and deletes them, covering the case where the compensating delete itself fails (process crash between steps).

#### Scenario: Reconciliation cleans up a true orphan

- GIVEN an Auth account U (created 1 hour ago) has no matching `profiles` row, and the compensating delete never ran
- WHEN the reconciliation job runs
- THEN U is deleted from `auth.users`

#### Scenario: Reconciliation does not touch recent signups mid-flight

- GIVEN an Auth account U was created 30 seconds ago and its `profiles` insert is still in flight
- WHEN the reconciliation job runs
- THEN U is NOT deleted (below the age threshold)

### Requirement: Admin bootstrap is a manual, documented runbook — not an endpoint

Per Q5, creating the first `super_admin` MUST NOT be exposed as an API endpoint. The runbook MUST be: (1) create the Auth user via the Supabase dashboard, (2) run a seed script with the service-role key that inserts `profiles` and `admin_roles(rol='super_admin', granted_by=self)`. `asignarRolAdmin` remains admin-only for every subsequent admin.

#### Scenario: No auto-provisioning admin endpoint exists

- GIVEN the completed change
- WHEN reviewing core-api's exposed routes
- THEN no endpoint creates an `admin_roles` row without an existing authenticated admin caller

#### Scenario: First super_admin is seeded manually

- GIVEN a fresh Supabase project with an Auth user created via dashboard
- WHEN the documented seed script runs with the service-role key
- THEN a `profiles` row and a self-granted `admin_roles(rol='super_admin')` row are created
