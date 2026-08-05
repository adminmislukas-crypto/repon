# Exploration: Scaffold `core-api` as a runnable NestJS application (hexagonal-per-domain foundation)

**Change**: `backend-core-api-foundation` | **Project**: `repon-monorepo`

## Current State

- `services/core-api/` has **zero code** — only `SPEC.md` (architecture) + `domains/*/SPEC.md` (6 domains: `identidad`, `catalogo`, `consumo`, `refill-matching`, `ofertas`, `pedidos-pagos`), each with typed inbound ports (use-cases), outbound ports (repositories/adapters as TS interfaces), and named-past-tense domain events.
- **No `package.json` exists anywhere in the repo** (confirmed via glob `**/package.json` → no results), no `pnpm-workspace.yaml`/`turbo.json`/`nx.json`/`.nvmrc`. `packages/types/` and `packages/ui/` are **SPEC.md-only**, no `.ts` files — `packages/types/SPEC.md` contains a full TS interface block (`Profile`, `Company`, `RefillRequest`, `Offer`, `OfferItem`, `Order`, `Payment`, `AuditLog`, etc.) but it is documentation prose, not an importable module.
- `.tool-versions` (created by `backend-supabase-migrations`, PR 0) pins only `supabase 2.111.0`, with a comment explicitly anticipating future asdf/mise adoption — no Node entry yet.
- DB layer (just archived) is complete: 17 tables, deny-all RLS + `revoke all` from `anon`/`authenticated` + explicit SELECT allowlists, **service-role bypasses RLS entirely** (`db-access-control/spec.md` Requirement "Deny-all default" + "No client-side mutation policies" — D1). `core-api` is the only writer for every table.
- `auth-provisioning/spec.md` defines the exact Auth↔`profiles` compensation contract (`AuthProvider.createAccount` → `profiles` insert `ON CONFLICT DO NOTHING`, compensating `deleteAccount` on deterministic failure, forward-recovery via `findAccountByEmail` on ambiguous failure) that `identidad`'s `AuthProvider` outbound port must implement — this is real logic, not just wiring, but it's in-scope for the skeleton because the port signature and its documented contract must exist even if the concrete adapter body is a later change.
- `openspec/config.yaml` (from `sdd-init`) records `strict_tdd: false` with `testing.status: not_configured`, `reason: "No package.json, test runner, ... detected anywhere in the repo"` — this is a **description of a pre-scaffolding vacuum**, not a deliberate no-testing policy. This change is the trigger for introducing a real test runner.
- `docs/ARCHITECTURE.md` confirms the target topology: 3 client types → `core-api` (NestJS, HTTP) → Postgres/Auth/Storage (Supabase, pure infra). "Ningún borrado físico" (soft delete via `status`) is a cross-cutting rule this API must enforce in every domain's use-cases, not just in `identidad`.
- Verified externally: NestJS 11.1.28 is current stable as of Aug 2026 (v12 not yet released). Node.js 24 is current Active LTS, Node 22 is Maintenance LTS.

## Affected Areas

- `services/core-api/**` — currently docs-only; this change adds all runtime code
- `packages/types/SPEC.md` — promoted to a real workspace package (`.ts` files) so `core-api` imports shared entity shapes rather than re-declaring them
- Repo root — needs `package.json`, workspace config, `tsconfig.base.json`, `.tool-versions` (Node line), `.nvmrc`
- `openspec/config.yaml` — `testing`/`strict_tdd` block will need updating once a real test runner exists (flagged, not decided in exploration)
- No existing tests, CI, or lint config anywhere to build on top of

## Resolved Decisions (orchestrator + user, post-exploration)

| # | Decision | Resolution |
|---|---|---|
| D1 | Package manager / monorepo tooling | **pnpm workspaces**, no Turborepo/Nx yet (YAGNI — `apps/*` are still HTML mockups, nothing to orchestrate a build pipeline across) |
| D2 | Domain scaffolding scope | **Shared kernel + `identidad` fully scaffolded**; the other 5 domains ship as thin empty module placeholders. Matches how `backend-supabase-migrations` sequenced `identidad` first (low coupling, best first proof-point). Avoids a 6-domains-at-once PR blowing the review budget. |
| D3 | `packages/types` promotion | Promoted to real `.ts` code **in this change** — `core-api`'s domain layer imports entity shapes from `@repon/types`, never re-declares them |
| D4 | Node version | **Node 24.x LTS**, pinned in both `.tool-versions` and `.nvmrc` |
| D5 | Swagger/OpenAPI exposure | **Dev-only** (`/api/docs` mounted only outside production) — avoids exposing the full API surface/DTO shapes in prod |
| D6 | Supabase data-access library | **Deferred to `sdd-design`** — `supabase-js` alone vs. `supabase-js` (Auth/Storage) + Kysely/`pg` (repositories, for real multi-statement transactions needed by `aceptarOferta`'s displacement and `crearPedidoDesdeOferta`'s snapshot-copy). Real transactional-integrity consequences, not a pure infra pick. |

## Hexagonal Skeleton Structure (per domain, `identidad` as the concrete example)

```
services/core-api/
├── src/
│   ├── main.ts                     ← bootstrap, Swagger setup (dev-only), global guards/pipes
│   ├── app.module.ts                ← imports SharedKernelModule + each DomainModule
│   ├── shared/
│   │   ├── supabase/                ← SupabaseModule (service-role client provider)
│   │   ├── event-bus/               ← EventEmitter2 wrapper + DomainEvent base type
│   │   ├── auth/                    ← JWT guard, role/admin-role loading (infra, not a domain)
│   │   ├── notifications/           ← Expo Push adapter (NotificationPort impl)
│   │   ├── payments/                ← Webpay/MercadoPago adapter (PaymentGatewayPort impl)
│   │   └── config/                  ← env validation (fail-fast on missing service-role key)
│   └── domains/
│       └── identidad/
│           ├── domain/              ← Profile, Company, AdminRole (plain TS, zero framework imports)
│           ├── ports-in/            ← IdentidadInboundPort + one class per use-case
│           │                           (RegistrarUsuario, RegistrarEmpresa, AprobarEmpresa,
│           │                            SuspenderUsuario, SuspenderEmpresa, AsignarRolAdmin)
│           ├── ports-out/           ← ProfileRepository, CompanyRepository, AuthProvider,
│           │                           EventPublisher — TS interfaces + DI injection tokens only
│           ├── contracts/           ← only for domains exposing a sync query port to others
│           │                           (e.g. catalogo's CatalogQueryPort) — the ONE thing another
│           │                           domain module is allowed to import
│           ├── adapters/
│           │   ├── http/            ← controllers + DTOs (class-validator + @ApiProperty) + mappers
│           │   ├── persistence/     ← Supabase/Postgres repository implementations
│           │   └── events/          ← EventEmitter2-based EventPublisher impl
│           └── identidad.module.ts  ← wires ports-out to adapters via DI tokens
└── test/
```

- The rule "nadie escribe en las tablas de otro dominio... nunca un dominio importa el repositorio de otro directamente" (`core-api/SPEC.md`) has a structural home: only a domain's `contracts/` folder is importable cross-domain; `ports-out/`, `adapters/persistence/`, and `domain/` never are. Enforced by folder convention + review for now (not Nx boundary tags — deferred per D1).
- DTOs live only in `adapters/http/` — domain/ports-in/ports-out never import `@nestjs/swagger` or `class-validator`. Controllers own `*Dto` classes; a thin mapper converts `Dto → port arguments` and `domain entity → response Dto`.

## Supabase Service-Role Client Wiring

`SharedKernelModule` (global) exposes a `SUPABASE_CLIENT` DI token, built once from `SUPABASE_URL` + `SUPABASE_SERVICE_ROLE_KEY` (validated at boot via `@nestjs/config` + a schema — fail hard on missing key, since a missing service-role key here removes the *only* authorization layer, RLS being bypassed by design for this connection).

## Auth/Guards Approach

Apps hold a Supabase Auth JWT independently (needed for Realtime `setAuth(token)` per the archived design's offer-invalidation flow). `core-api` needs an `AuthGuard` that verifies the JWT, extracts `sub` (= `auth.uid()` = `profiles.id`), then loads `role` and, if `admin`, the `admin_roles.rol` sub-role — using the same service-role client, since RLS is bypassed and there's no other way to read `profiles` for an arbitrary caller. A `RolesGuard`/`@Roles()` decorator sits on top for the 3 admin sub-roles.

**Highest-risk new component**: previously RLS made "wrong tenant sees another tenant's row" structurally impossible for direct client reads; with service-role bypass, that invariant now lives entirely in this guard + each use-case's authorization checks, with zero DB-level backstop for `core-api`'s own connection.

JWT verification mechanism (`SUPABASE_JWT_SECRET` HS256 vs. JWKS RS256) depends on the actual Supabase project's Auth signing-key configuration, which isn't visible from the repo — build this configurable via env var, actual values supplied when the project is provisioned.

## Testing Setup

Standard NestJS testing: Jest via `@nestjs/testing`'s `Test.createTestingModule` for unit tests of ports-in use-cases with mocked ports-out (no DB needed), `supertest` for e2e HTTP tests, integration tests against the already-scaffolded local Supabase stack (`supabase start`, `localhost:54322`).

**Flagged, not decided in exploration**: `openspec/config.yaml`'s `strict_tdd: false` exists because nothing existed to be strict about. This change removes that precondition. Whether to flip `strict_tdd: true` for domains 2-6 and future `core-api` changes is a call for `sdd-tasks`/the orchestrator to make explicitly when scaffolding the test runner, not something to decide unilaterally in exploration.

## Risks

- **Authorization moved from DB (RLS) to application code with zero structural backstop.** A bug in `AuthGuard`/role-loading or a single use-case's manual authorization check has full cross-tenant blast radius on the service-role connection.
- **`packages/types` promotion is a hidden sequencing dependency** (resolved: happens in this change, per D3) — if it were deferred, `core-api`'s domain layer would re-declare types that drift from the SPEC.md source of truth.
- **`AuthProvider`'s compensation contract is genuine logic, not wiring** — if the scaffolding stubs this port, it must be an explicit, documented stub, not a silent placeholder, since a naive later implementation could skip the compensating-delete/forward-recovery logic already finalized in `auth-provisioning/spec.md`.
- **No CI exists yet** — this change's "definition of done" is a checklist, not a gate, same as the DB change. Whether this change also stands up minimal CI (lint/typecheck/test on PR) is a `sdd-tasks` call.

## Ready for Proposal

Yes — architecture is well-specified enough (6 domain SPEC.md files with concrete port signatures, a finalized DB schema, documented RLS/service-role model) for `sdd-propose` to build on top of the resolved decisions above.
