# Delta for core-api-identidad

## ADDED Requirements

### Requirement: AuthProvider gains signIn for password-grant verification, still without tx?

`AuthProvider` MUST gain a `signIn` capability that, given an email and password, resolves to exactly one of: a verified identity (session material — exact fields are `sdd-design`'s job, Q1/Q2), `AuthProviderDeterministicError(reason: 'invalid_credentials')` (reused as-is, no new class), or `AuthProviderAmbiguousError` (timeout/5xx, mapped to 503 by the caller — mirrors the existing `registrarUsuario` ambiguous-failure pattern). `signIn` MUST NOT accept a `tx?: TransactionContext` parameter, consistent with the existing rule that `AuthProvider` never participates in the SQL transaction. Resolving `profiles.status`, `companies.status`, and the app-role match is domain/use-case logic, not `AuthProvider`'s responsibility — the same separation already established for `registrarUsuario` (the adapter classifies transport-level failures only).

#### Scenario: signIn reuses the existing invalid_credentials reason

- GIVEN a wrong password or an unknown email
- WHEN `AuthProvider.signIn` is called
- THEN it throws `AuthProviderDeterministicError(reason: 'invalid_credentials')` — no new error class

#### Scenario: signIn never receives a transaction context

- GIVEN `AuthProvider`'s method signatures after this change
- WHEN they are enumerated
- THEN `signIn`, like `createAccount`/`deleteAccount`/`findAccountByEmail`, has no `tx?` parameter

### Requirement: Existing identidad routes and token verification are unaffected

`POST /identidad/usuarios` (registration) and the existing `AuthGuard`/`RolesGuard`/`JwtVerifier` token-verification pipeline MUST behave identically after this change. `POST /identidad/sesion` is additive and `@Public()`; it MUST NOT change any existing use case's signature, any existing route's behavior, or how an already-issued token is verified.

#### Scenario: Registration is unaffected

- GIVEN the existing `registrarUsuario` flow
- WHEN this change ships
- THEN `POST /identidad/usuarios` behaves identically — same request/response shape, same compensation saga

#### Scenario: The existing identidad test suite has no regression

- GIVEN the existing unit + e2e suite for `identidad`
- WHEN this change's routes/use cases are added
- THEN the full existing suite still passes unmodified

#### Scenario: An existing protected route still accepts the same token shape

- GIVEN a token issued by `POST /identidad/sesion` (the same GoTrue JWT format `AuthGuard` already verifies — no locally minted JWT)
- WHEN it is presented to an existing protected route
- THEN `AuthGuard`/`JwtVerifier` authenticate it exactly as any other valid GoTrue JWT — no guard code change
