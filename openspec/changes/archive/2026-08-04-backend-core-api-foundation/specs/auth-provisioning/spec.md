# auth-provisioning Specification (delta — backend-core-api-foundation)

## Purpose of this delta

The archived `backend-supabase-migrations` change specified the Auth↔`profiles` compensation flow at the database/contract level ("the system MUST delete") without naming which API-layer component performs the deletion. This change's `sdd-design` (Q2) resolved that ambiguity. This delta makes it explicit — no behavior changes, only clarifies ownership.

## Modified Requirements

### Requirement: Compensating delete on partial provisioning failure

If `AuthProvider.createAccount` succeeds but the subsequent `profiles` insert fails (e.g. constraint violation), the system MUST delete the just-created `auth.users` row as a compensating action, since there is no shared transaction across the two systems (R5).

**Clarification (this change)**: the orchestrating component MUST be the `identidad` use-case (`RegistrarUsuarioUseCase`), not the `AuthProvider` adapter. The use-case holds both the `AuthProvider` port and the `ProfileRepository` port simultaneously and is the only component that can observe both the Auth-creation result and the profile-insert result to decide whether compensation is needed. The `AuthProvider` adapter's only added responsibility is classifying a failure as deterministic (safe to compensate) vs. ambiguous (network/timeout — must NOT compensate, must recover forward via `findAccountByEmail` instead, per `core-api-identidad`'s spec in this same change).

#### Scenario: Deterministic profiles-insert failure triggers use-case-owned compensation

- GIVEN `RegistrarUsuarioUseCase` has just received a successful `AuthProvider.createAccount(email, password)` result with id U
- WHEN the subsequent `ProfileRepository.insertIfAbsent` call fails with a deterministic error (e.g. a constraint violation, not a timeout)
- THEN `RegistrarUsuarioUseCase` itself calls `AuthProvider.deleteAccount(U)` as compensation
- AND the `AuthProvider` adapter implementation never independently decides to delete an account on its own

#### Scenario: Ambiguous Auth-creation failure never triggers compensation from within the adapter

- GIVEN `RegistrarUsuarioUseCase` calls `AuthProvider.createAccount(email, password)`
- WHEN the call fails with an ambiguous error (timeout, 5xx — success/failure of the underlying Auth write is unknown)
- THEN the `AuthProvider` adapter classifies this as `AuthProviderAmbiguousError` and does NOT call `deleteAccount` itself
- AND `RegistrarUsuarioUseCase` is the component that decides to recover forward via `AuthProvider.findAccountByEmail`, per `core-api-identidad`
