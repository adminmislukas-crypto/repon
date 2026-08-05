# core-api-auth-guard Specification

## Purpose

Two global guards (`AuthGuard`, `RolesGuard`) are the sole authorization layer for `core-api`'s service-role DB connection — RLS is bypassed on this connection, so there is zero DB-level backstop (R1). Fail-closed by default; `@Public()` is the only opt-out.

## Requirements

### Requirement: ActorPort is declared by the kernel, implemented by identidad

`shared/auth` MUST declare `ActorPort` (`findActorById(profileId): Promise<AuthenticatedActor | null>`) and `AuthenticatedActor` (`profileId`, `role`, `status`, `companyId`, `companyStatus`, `adminRole`) without importing any domain. `IdentidadModule` MUST provide `ACTOR_PORT` via `IdentidadActorAdapter` (in `domains/identidad/contracts/`), resolving the actor with one JOIN across `profiles ⋈ admin_roles ⋈ companies`, and MUST export it. `AppModule` MUST register `AuthGuard`/`RolesGuard` as `APP_GUARD` only after importing both `AuthModule` and `IdentidadModule` (registering the guard inside `AuthModule` would create a cycle with `IdentidadModule`).

#### Scenario: Actor resolution is a single query

- GIVEN an authenticated request for profile P
- WHEN `ActorPort.findActorById(P)` is called
- THEN exactly one query resolves `role`, `status`, `companyId`, `companyStatus`, and `adminRole` — no separate round-trip per field

#### Scenario: No caching of resolved actors

- GIVEN two consecutive requests from the same profile
- WHEN both are authenticated
- THEN `findActorById` is invoked once per request; no actor is reused across requests

### Requirement: AuthGuard authentication matrix

`AuthGuard` runs first, before `RolesGuard`. `@Public()` bypasses it entirely.

#### Scenario: Public route bypasses authentication

- GIVEN a handler decorated `@Public()`
- WHEN requested with no `Authorization` header
- THEN it proceeds to the controller with `request.actor` undefined

#### Scenario: Missing or malformed bearer token

- GIVEN a non-`@Public()` route and no/malformed `Authorization` header
- WHEN requested
- THEN it responds 401 `MISSING_BEARER_TOKEN`

#### Scenario: Token fails signature, issuer, audience, or expiry verification

- GIVEN a bearer token that `JwtVerifier.verify` rejects
- WHEN requested
- THEN it responds 401 `INVALID_TOKEN`

#### Scenario: Token sub claim is not a UUID

- GIVEN a syntactically valid token whose `sub` claim is not a UUID
- WHEN requested
- THEN it responds 401 `INVALID_TOKEN`

#### Scenario: Actor backend is unreachable

- GIVEN `ActorPort.findActorById` throws
- WHEN requested
- THEN it responds 503 `AUTH_BACKEND_UNAVAILABLE` — the request is never allowed through on an infrastructure failure

#### Scenario: Token valid but no matching profile

- GIVEN `ActorPort.findActorById` resolves `null`
- WHEN requested
- THEN it responds 401 `PROFILE_NOT_PROVISIONED` (a valid token with no known identity is not a permissions failure)

#### Scenario: Profile is suspended

- GIVEN the resolved actor has `status === 'suspendido'`
- WHEN requested
- THEN it responds 403 `PROFILE_SUSPENDED` (a known identity denied access, distinct from an unknown one — 403 not 401 avoids a refresh-token retry loop)

#### Scenario: Provider with a suspended company still authenticates

- GIVEN the resolved actor has `role: 'provider'` and `companyStatus: 'suspendido'`
- WHEN requested
- THEN `AuthGuard` allows the request through — blocking on a suspended company is a business rule owned by each use case (`ofertas`/`catalogo`), not this guard

#### Scenario: Valid active actor proceeds

- GIVEN a valid token resolving to an actor with `status: 'activo'`
- WHEN requested
- THEN `request.actor` is set to the `AuthenticatedActor` and the request proceeds to `RolesGuard`

### Requirement: RolesGuard authorization matrix

`RolesGuard` runs after `AuthGuard`, reading `@Roles()`/`@AdminRoles()` metadata (handler, falling back to class).

#### Scenario: No role metadata allows any authenticated actor

- GIVEN a handler with neither `@Roles()` nor `@AdminRoles()`
- WHEN a valid actor requests it
- THEN it proceeds to the controller

#### Scenario: Role not in the allowed list

- GIVEN a handler decorated `@Roles('provider')` and an actor with `role: 'user'`
- WHEN requested
- THEN it responds 403 `ROLE_NOT_ALLOWED`

#### Scenario: Admin route requires role admin

- GIVEN a handler decorated `@AdminRoles(...)` and an actor with `role !== 'admin'`
- WHEN requested
- THEN it responds 403 `ROLE_NOT_ALLOWED`

#### Scenario: Admin actor without a sub-role row

- GIVEN `@AdminRoles(...)` and an actor with `role: 'admin'` and `adminRole: null`
- WHEN requested
- THEN it responds 403 `ADMIN_SUBROLE_MISSING`

#### Scenario: Admin sub-role not in the allowed list

- GIVEN `@AdminRoles('super_admin')` and an actor with `adminRole: 'soporte'`
- WHEN requested
- THEN it responds 403 `ADMIN_SUBROLE_NOT_ALLOWED`

#### Scenario: Allowed admin sub-role reaches the controller

- GIVEN `@AdminRoles('super_admin','soporte')` and an actor with `adminRole: 'soporte'`
- WHEN requested
- THEN it proceeds to the controller with `@Actor()` injecting the `AuthenticatedActor`

### Requirement: JWT verification is configurable, chosen once at boot

`JwtVerifier.verify(token)` MUST validate signature, issuer (`AUTH_JWT_ISSUER`), audience (`AUTH_JWT_AUDIENCE`), and expiry, and MUST support two modes selected once by `AUTH_JWT_MODE` at boot (`hs256` via `SUPABASE_JWT_SECRET`, `jwks` via `SUPABASE_JWKS_URL`) — never re-selected per request.

#### Scenario: Mode is fixed for the process lifetime

- GIVEN `AUTH_JWT_MODE=hs256` at boot
- WHEN any request is authenticated during that process's lifetime
- THEN verification always uses the HS256 secret path, regardless of token contents

### Requirement: AuthenticatedActor never crosses the ports-in boundary

Controllers MUST read the actor via `@Actor()` and pass explicit scalars (e.g. `actor.profileId` → `adminId`) to use-case methods. `AuthenticatedActor` MUST NOT be passed as a use-case parameter, and MUST NOT expose the raw token or JWT claims — nothing downstream can re-derive authority from unverified data.

#### Scenario: Controller passes scalars, not the actor object

- GIVEN `POST /identidad/empresas/:id/aprobacion` with `@AdminRoles('super_admin','soporte')`
- WHEN the controller calls `AprobarEmpresaUseCase.execute`
- THEN it passes `companyId` and `actor.profileId` as separate string arguments, never the `AuthenticatedActor` object itself

### Requirement: A global exception filter emits stable error codes

Every guard rejection MUST surface as `{ statusCode, code, message }` with a stable `code` (e.g. `PROFILE_SUSPENDED`, `ADMIN_SUBROLE_NOT_ALLOWED`); no internal error detail (stack traces, DB errors) MUST leak into the response body.

#### Scenario: Suspended profile gets a stable code, not a stack trace

- GIVEN `PROFILE_SUSPENDED` is thrown by `AuthGuard`
- WHEN the response is serialized
- THEN the body is `{ statusCode: 403, code: 'PROFILE_SUSPENDED', message: string }` with no stack trace or internal detail
