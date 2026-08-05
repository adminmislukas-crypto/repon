# core-api-bootstrap Specification

## Purpose

The runtime process: env validation, global pipes, Swagger exposure, and the module composition that wires the shared kernel and all 6 domain modules into one process.

## Requirements

### Requirement: Env validation fails fast at boot

The process MUST validate its environment schema at boot and exit non-zero with a clear message if a required variable is missing, BEFORE accepting any HTTP connection. Required unconditionally: `SUPABASE_URL`, `SUPABASE_SERVICE_ROLE_KEY`, `DATABASE_URL`. `AUTH_JWT_MODE` MUST be a discriminated union (`hs256` | `jwks`): `SUPABASE_JWT_SECRET` is required iff mode is `hs256`; `SUPABASE_JWKS_URL` is required iff mode is `jwks`. `AUTH_JWT_ISSUER` and `AUTH_JWT_AUDIENCE` are always required.

#### Scenario: Missing service-role key halts boot

- GIVEN `SUPABASE_SERVICE_ROLE_KEY` is absent from the environment
- WHEN the process starts
- THEN it exits with a non-zero code and a message naming the missing variable, and never opens the HTTP listener

#### Scenario: hs256 mode without its secret halts boot

- GIVEN `AUTH_JWT_MODE=hs256` and `SUPABASE_JWT_SECRET` absent
- WHEN the process starts
- THEN it exits non-zero before accepting requests

#### Scenario: A fully valid env starts cleanly

- GIVEN all required keys for the chosen `AUTH_JWT_MODE` are present
- WHEN the process starts
- THEN `GET /health` responds 200

### Requirement: Swagger is dev-only

`/api/docs` MUST be mounted only when `NODE_ENV !== 'production'` (D5).

#### Scenario: Docs are reachable in development

- GIVEN `NODE_ENV=development`
- WHEN `GET /api/docs` is requested
- THEN it responds 200 with the OpenAPI UI

#### Scenario: Docs 404 in production

- GIVEN `NODE_ENV=production`
- WHEN `GET /api/docs` is requested
- THEN it responds 404

### Requirement: Global validation pipe rejects malformed DTOs

A global `ValidationPipe` (whitelist + forbidNonWhitelisted) MUST reject any request body that fails its DTO's `class-validator` decorators before it reaches a controller method.

#### Scenario: Unknown field is rejected

- GIVEN a `POST /identidad/usuarios` body with an extra unrecognized field
- WHEN the request is sent
- THEN it responds 400 and the controller method is never invoked

### Requirement: Module composition wires the shared kernel and all 6 domains

A global `SharedKernelModule` (`@Global()`) MUST be imported once by `AppModule`, which also imports one module per domain (`IdentidadModule` fully implemented, 5 placeholders). The process MUST start successfully with all 7 modules registered.

#### Scenario: App boots with every domain module registered

- GIVEN a valid environment
- WHEN the process starts
- THEN `IdentidadModule` and the 5 placeholder domain modules all resolve in the Nest dependency graph with no unresolved provider

### Requirement: Shared kernel exposes fixed tokens for cross-cutting infra

`SharedKernelModule` MUST provide `SUPABASE_CLIENT` (Auth Admin + Storage only), `DATABASE` (`Kysely<DB>`), and `TRANSACTION_MANAGER`. `NOTIFICATION_PORT` and `PAYMENT_GATEWAY_PORT` MUST be declared (interface + token) with no bound implementation in this change — their adapters ship with the domain change that consumes them.

#### Scenario: The pg connection carries service-role grants

- GIVEN the `DATABASE` pool is configured
- WHEN a query attempts `UPDATE`/`DELETE` against `audit_log`
- THEN it is rejected by the connection's role grants — the backstop RLS would otherwise provide

### Requirement: DI tokens are Symbols, never strings

Every cross-cutting DI token (shared kernel and domain ports-out) MUST be declared as `Symbol('NAME')` exactly once, in the same file as its interface. String tokens MUST NOT be used.

#### Scenario: EVENT_PUBLISHER cannot collide silently

- GIVEN `identidad`, `ofertas`, and `pedidos-pagos` each depend on `EVENT_PUBLISHER`
- WHEN the token is declared
- THEN it is a single `Symbol('EVENT_PUBLISHER')` exported from `shared/event-bus/` and imported by all three — never three separate string literals that could collide

### Requirement: Placeholder domain modules declare real tokens, bind nothing

Each of the 5 non-`identidad` domain modules (`catalogo`, `consumo`, `refill-matching`, `ofertas`, `pedidos-pagos`) MUST declare its own ports-out DI tokens using the exact names from its own `SPEC.md` (`CATALOG_REPOSITORY`, `CATALOG_QUERY_PORT`, `CONSUMPTION_REPOSITORY`, `CONSUMPTION_LOG_REPOSITORY`, `REFILL_REPOSITORY`, `OFFER_REPOSITORY`, `ORDER_REPOSITORY`) and register its module in `AppModule`, but MUST NOT bind any provider for them. `useValue: {}` is explicitly forbidden — a missing provider MUST fail loudly at boot, not silently no-op.

#### Scenario: A placeholder token has no provider

- GIVEN `CatalogModule` declares `CATALOG_REPOSITORY` and `CATALOG_QUERY_PORT`
- WHEN `AppModule` boots
- THEN neither token has a bound provider, and nothing in this change attempts to inject them

#### Scenario: A useValue stub fails review

- GIVEN a placeholder module PR includes `{ provide: CATALOG_REPOSITORY, useValue: {} }`
- WHEN it is reviewed against this requirement
- THEN it does not satisfy the requirement — a no-op stub provider is forbidden

### Requirement: Health check is unauthenticated

`GET /health` MUST be reachable without a bearer token (`@Public()`) and MUST remain 200 after `AuthGuard` is registered globally in slice 4.

#### Scenario: Health stays open after guards are wired

- GIVEN `AppModule` registers `AuthGuard` as `APP_GUARD`
- WHEN `GET /health` is requested with no `Authorization` header
- THEN it responds 200
