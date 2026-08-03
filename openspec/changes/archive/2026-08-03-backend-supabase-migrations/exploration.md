# Exploration: `supabase/SPEC.md` → Real Postgres Migrations + RLS + Storage + Auth

**Change**: `backend-supabase-migrations` | **Project**: `repon-monorepo`

## Current State

- `supabase/` currently contains **only `SPEC.md`**. `supabase/migrations/` and `supabase/functions/` do not exist as directories at all (confirmed via glob, zero matches) — the README's "a generar" is accurate, this is a from-scratch build.
- `supabase/SPEC.md` defines: a 16-table creation order (FK-respecting), a prose RLS table (7 rows covering all 16 tables via grouping), 4 Edge Functions, and a pre-migration checklist that explicitly says column names still need to be confirmed against `packages/types/SPEC.md`.
- `packages/types/SPEC.md` only defines **8 of the 16** table shapes as TS interfaces (`Profile`, `Pet`, `UserConsumption`, `RefillRequest`, `RefillItem`, `Offer`, `OfferItem`, `Order`). The other 8 (`companies`, `admin_roles`, `catalog_products`, `provider_catalog`, `consumption_logs`, `order_items`, `payments`, `audit_log`) have **no column-level definition anywhere in the repo** — only table names and one-line descriptions in `docs/DATA_MODEL.md`.
- All 6 domain `SPEC.md`s were cross-checked against `supabase/SPEC.md`'s table list: **every entity each domain owns maps 1:1 to an existing table name** in `supabase/SPEC.md`. No domain references a table that doesn't exist in the list. That part is consistent.
- The project is pre-implementation (no package.json/test runner/CI anywhere), so this migration work is genuinely "day one" infra.

## 1. Full Table List — Cross-Referenced

| # | Table | Owning domain | Column-level spec exists? | Notes |
|---|-------|---------------|---------------------------|-------|
| 1 | `companies` | identidad | **No** (only in prose: razón social, RUT, giro, zonas de despacho, status) | `rating` mentioned in `admin-web/SPEC.md` but never defined anywhere as a column/computation |
| 2 | `profiles` | identidad | Partial (`packages/types/SPEC.md`) | **Missing a `status` field** despite `suspenderUsuario` use case existing — see Risks |
| 3 | `admin_roles` | identidad | **No** (only enum `AdminRole` type, no table shape: FK to profile, scope?) | |
| 4 | `pets` | consumo | Yes | |
| 5 | `catalog_products` | catalogo | **No** | Only described as "catálogo de referencia general" |
| 6 | `provider_catalog` | catalogo | **No** (`ProviderCatalogItem` mentioned in domain SPEC but no field list) | Unclear if it FKs to `catalog_products` — see Risks |
| 7 | `user_consumption` | consumo | Yes | |
| 8 | `consumption_logs` | consumo | **No** | Domain SPEC only describes behavior (`adherenciaUltimos7Dias`), not columns |
| 9 | `refill_requests` | refill-matching | Yes | |
| 10 | `refill_items` | refill-matching | Yes | No `catalog_product_id` FK — matches by free-text `categoria`/`nombre` |
| 11 | `offers` | ofertas | Yes | **No status/lifecycle field** despite `aceptarOferta` use case — see Risks |
| 12 | `offer_items` | ofertas | Yes | |
| 13 | `orders` | pedidos-pagos | Yes | |
| 14 | `order_items` | pedidos-pagos | **No** | |
| 15 | `payments` | pedidos-pagos | **No** | Domain SPEC says "never card data" but no column list for what IS stored |
| 16 | `audit_log` | identidad (cross-cutting) | **No** | `docs/DATA_MODEL.md` says "quién, sobre qué entidad, qué cambió, cuándo" — implies polymorphic FK design (entity_type + entity_id), undefined |

**Finding**: table *names* are fully consistent across `supabase/SPEC.md`, `docs/DATA_MODEL.md`, and the 6 domain SPECs. The gap is **column-level detail is missing for exactly half the tables (8/16)**. `supabase/SPEC.md`'s own checklist already flags this ("confirmar nombres finales de columnas") — it just hasn't been done. This is the single biggest blocker to writing real migrations and must be resolved in `sdd-propose`/`sdd-spec`, not guessed here.

## 2. RLS Policy Requirements Per Table

`supabase/SPEC.md`'s RLS table groups 16 tables into 7 rules. Reconciled against domain SPECs:

| Table(s) | Rule (as specified) | Implementation complexity found |
|---|---|---|
| `profiles` | Own row only (`auth.uid() = id`) | Simple |
| `pets`, `user_consumption`, `consumption_logs` | Owner (`userId`) only | `consumption_logs` has no direct `userId` — likely needs join through `user_consumption` |
| `refill_requests`, `refill_items` | Owner read/write; providers read-only if catalog matches + in dispatch zone | **`refill_items` has no owner column** — needs `EXISTS` subquery to parent `refill_requests`. The "zona de despacho" match is **not implementable as a pure RLS predicate** with current schema — see Risks (#R3) |
| `provider_catalog` | Editable only by profiles with matching `companyId` | Needs `company_id IN (SELECT company_id FROM profiles WHERE id = auth.uid())` |
| `offers`, `offer_items` | Provider creates/edits own; user reads only offers on their own requests | `offer_items` has no owner column — subquery via `offers` |
| `orders`, `payments` | Visible only to the user and provider involved | `order_items` (not explicitly in this row but implied) needs subquery via `orders` |
| `admin_roles`, `audit_log` | No public/anon/authenticated access — service-role only from `admin-web` | Simplest — deny-all for anon/authenticated roles |
| `catalog_products` | **Not covered by any RLS row in `supabase/SPEC.md`** | Gap — presumably public read (it's the searchable reference catalog used by unauthenticated/anon browsing?), never stated |

**Cross-cutting pattern**: every "child" table (`refill_items`, `offer_items`, `order_items`, `consumption_logs`) lacks its own owner column and requires a nested `EXISTS` RLS policy against its parent — this is a known-but-non-trivial Postgres RLS pattern that needs to be designed consistently, not table-by-table ad hoc.

**Open architectural question that changes everything about RLS scope**: does `core-api` (NestJS) talk to Supabase Postgres using the **service role key** (bypasses RLS entirely) or does it forward the end user's JWT (RLS enforced)? `docs/ARCHITECTURE.md` says apps read simple data directly via anon key (RLS matters there), but all *writes* with business rules go through `core-api`. If `core-api` uses service-role for writes, the RLS *write* policies above are effectively decorative for the core-api path and only matter for the rare direct-read paths — this needs to be an explicit decision before writing policies, not discovered after.

## 3. Storage Buckets Needed

Only two are named anywhere (`docs/ARCHITECTURE.md`, one line: "Storage | Fotos de productos, comprobantes"), plus one implied by `apps/proveedor-mobile/SPEC.md`:

1. **Product/catalog images** ("fotos de productos") — feeds `catalog_products`/`provider_catalog`. Likely public-read (marketplace browsing), write restricted to the owning provider (`company_id` match) or admin for reference catalog images. No bucket name, path convention, size/type limits specified anywhere.
2. **"Comprobantes"** — named in `docs/ARCHITECTURE.md` but **never elaborated anywhere else**. No domain SPEC (not even `pedidos-pagos`) mentions a file/URL field on `orders` or `payments`, no upload use case exists in any inbound port. Ambiguous whether this means payment receipts (odd, since checkout is hosted and PCI scope is explicitly avoided) or proof-of-delivery photos (more likely, given `Order.status` includes `en_camino`/`entregado`, but no field exists to attach an image to that status change). **This is a real content gap, not just missing config.**
3. **Bulk catalog upload files** (`.xlsx`/`.csv`, implied by `apps/proveedor-mobile/SPEC.md`: "la carga masiva necesita... subida a Supabase Storage + inserción batch") — private, provider-write-own-path, processed by `cargarCatalogoMasivo` then likely archived/deleted.

No avatar/profile-photo bucket is implied — both mockups use text-initial badges (`<div class="avatar">VS</div>`), not image uploads.

Storage buckets need their **own** `storage.objects` RLS policies, separate from table RLS — not mentioned anywhere in `supabase/SPEC.md`.

## 4. Auth Requirements

- `profiles.id` is a 1:1 FK extension of `auth.users.id` (confirmed in `docs/DATA_MODEL.md`: "Referencia a `auth.users` de Supabase"). `auth.users` is Supabase-managed — no migration needed for it, but it's an implicit dependency-zero for `profiles`.
- Per `identidad` domain SPEC, `AuthProvider.createAccount(email, password)` is called from the domain use case, then the domain presumably inserts the `profiles` row itself — **not** a DB trigger on `auth.users` insert. This means `core-api` must handle the two-step (Auth signup + profiles insert) atomically/compensating, since they're not in the same Postgres transaction. Not addressed anywhere.
- Only `email`/`password` implied; `profiles.telefono` is optional and not stated to be an auth factor.
- Roles (`user`/`provider`/`admin`) live in `profiles.role`, an app-level enum — no mention of Supabase custom JWT claims or Auth Hooks. Given the RLS design is structural (own-id, own-companyId, deny-all for admin tables) rather than claim-based, custom claims may not be strictly required — worth confirming as a decision, not assuming.
- `admin_roles` sub-roles (`super_admin`/`soporte`/`finanzas`) are **only reachable via service-role key from `admin-web` API routes** — Postgres RLS plays no role in distinguishing between the three; `admin-web/SPEC.md` itself lists this as "Pendiente" ("definir política RLS específica para `admin_roles`... cómo las API routes verifican el rol").
- **Bootstrap problem**: there is no self-registration path for the `admin` role — `asignarRolAdmin` is itself an authenticated admin action. Nothing in any SPEC describes how the *first* `super_admin` gets created. Needs a manual seed/out-of-band step.

## 5. Migration Ordering / Dependencies

`supabase/SPEC.md`'s 16-step order was traced against every FK relationship declared across `docs/DATA_MODEL.md` and the domain SPECs — **it is internally consistent, no ordering bugs found**:

```
0. auth.users (Supabase-managed, not migrated by us — implicit dependency)
1. companies
2. profiles          (FK → companies, optional; FK → auth.users, required)
3. admin_roles        (FK → profiles)
4. pets               (FK → profiles)
5. catalog_products    (no FK)
6. provider_catalog    (FK → companies)
7. user_consumption   (FK → profiles, pets)
8. consumption_logs    (FK → user_consumption)
9. refill_requests    (FK → profiles)
10. refill_items      (FK → refill_requests)
11. offers            (FK → refill_requests, companies)
12. offer_items       (FK → offers, refill_items)
13. orders            (FK → offers)
14. order_items       (FK → orders)
15. payments           (FK → orders)
16. audit_log          (FK → profiles)
```

Additional ordering concerns **not covered** by `supabase/SPEC.md`'s table but required for a real Supabase project:
- Extensions (`pgcrypto`/`uuid-ossp` for UUID PKs) must be enabled before any table creation.
- RLS policies should be written in the **same migration** as the table (per SPEC.md's own checklist item — good instinct already documented).
- Realtime publication must be enabled on `offers` (per `docs/ARCHITECTURE.md`'s "bandeja... vía Realtime") — not listed as a migration step anywhere.
- Storage buckets + their RLS are a separate concern from table migrations (via Supabase CLI/dashboard config, or `storage.objects` policies), not sequenced anywhere.
- `pg_cron` extension + the actual cron job registration for the daily consumption check depends on the `check-consumption-stock` Edge Function being deployed first.

## 6. Open Questions for `sdd-propose`

1. **Column-level schema for the 8 undocumented tables** (`companies`, `admin_roles`, `catalog_products`, `provider_catalog`, `consumption_logs`, `order_items`, `payments`, `audit_log`) — must be defined before any migration SQL can be written. This is not optional groundwork, it's the actual bulk of the work.
2. **Does `core-api` connect to Postgres via service-role key (RLS bypass) or forwarded user JWT?** This decides whether write-side RLS policies are load-bearing or defense-in-depth only.
3. **Structure of "zona de despacho"** — is it a list of comuna names on `companies`, postal codes, or a geo-polygon? And does `refill_requests` need a structured zone/comuna column (derived from its free-text `direccion`) to make the RLS/matching rule ("proveedores... en zona de despacho") actually implementable as SQL, or is that entirely the Edge Function's job (in which case the RLS table's wording in `supabase/SPEC.md` overstates what RLS alone can enforce)?
4. **What exactly is a "comprobante"** (payment receipt vs. proof-of-delivery photo), which table references it, and who uploads it?
5. **Should `provider_catalog`/`refill_items` have a hard FK to `catalog_products.id`**, or is free-text `categoria`/`nombre` matching intentional? Current domain SPECs (`CatalogQueryPort.buscarCoincidencias(categoria, nombre)`) suggest the latter, which is a data-quality risk for a matching engine.
6. **Admin bootstrap**: how is the first `super_admin` created, given no self-registration path exists for that role?
7. **Custom JWT claims/Auth Hooks**: needed at all, given RLS here is structural rather than claim-based?
8. **`catalog_products` RLS**: public/anon read, or authenticated-only? Not covered by any row in the existing RLS table.

## 7. Risks

- **R1 — Missing lifecycle/status fields on core entities contradicts the project's own stated principle.** `docs/ARCHITECTURE.md` states as a universal rule: "Ningún borrado físico... Todo pasa por un campo `status`." Yet `packages/types/SPEC.md`'s `Profile` type has **no `status` field** (only `Company` does, via `CompanyStatus`), and `Offer` has **no status/lifecycle field at all** despite `aceptarOferta` being a defined use case and `OfertaAceptada` a defined event — there is currently no column to represent "pending/accepted/rejected/expired" for an offer. This is a direct inconsistency between `docs/ARCHITECTURE.md` (the stated cross-cutting rule) and `packages/types/SPEC.md` (the concrete contract), and must be resolved before migrations are written, not patched in later.
- **R2 — `supabase/SPEC.md` has zero column definitions for half its tables**, contradicting the README's characterization of it as "the target contract." Treating it as migration-ready today would produce incomplete or invented schemas for `companies`, `admin_roles`, `catalog_products`, `provider_catalog`, `consumption_logs`, `order_items`, `payments`, `audit_log`.
- **R3 — RLS table in `supabase/SPEC.md` describes a rule ("zona de despacho" matching) that likely cannot be expressed as a pure RLS predicate** with the currently-specified columns (free-text address, no structured zone field). If this is actually enforced only inside the `match-refill-request` Edge Function, the RLS table's wording is misleading and should be corrected, not implemented literally.
- **R4 — Nested-ownership RLS pattern** (child tables with no direct owner column: `refill_items`, `offer_items`, `order_items`, `consumption_logs`) needs a consistent `EXISTS`-subquery convention decided once, not reinvented per table — inconsistent implementations here are a common source of RLS bugs (accidental data leaks or overly-restrictive denials).
- **R5 — Auth/DB atomicity gap**: `AuthProvider.createAccount` (Supabase Auth) and the `profiles` insert are two separate systems with no shared transaction. No compensating-action strategy is specified for partial failure (Auth user created, profile insert fails, or vice versa).
- **R6 — Undefined "comprobantes" storage use case** could hide an unaddressed requirement (e.g., proof-of-delivery) that no domain `SPEC.md` currently models at all — if it's dropped, that's a silent scope loss; if it's real, several domain SPECs need updates outside just `supabase/SPEC.md`.
- **R7 — Free-text category/name matching** (`refill_items`, `provider_catalog` have no FK to `catalog_products`) is a real risk to marketplace matching quality (typos/synonyms silently break the matching engine) and should be flagged for a normalization decision even if out of strict scope for "just write the migrations."

## Approaches (delivery strategy for `sdd-propose`/`sdd-tasks`)

1. **Big-bang single migration set** — write all 16 tables + RLS + buckets + auth config as one large PR/change.
   - Pros: one coherent artifact, easy to reason about FK order in one pass.
   - Cons: guaranteed to blow the 400-line review budget by a wide margin (16 tables × columns × RLS policies × indexes); a single review has to hold the entire schema in their head at once; any late-discovered gap (see R1/R2 above) forces a full redo.
   - Effort: High.
2. **Incremental, domain-ordered migrations** — one migration PR per domain, following the dependency chain already validated above (identidad → consumo → catalogo → refill-matching → ofertas → pedidos-pagos → cross-cutting `audit_log`), each including its own RLS in the same PR (per SPEC.md's own checklist instinct).
   - Pros: matches the FK dependency order that's already correct; each PR is independently reviewable and testable; isolates the "undefined columns" gap-filling work per domain instead of blocking on all 8 undocumented tables at once; fits the review workload guard naturally.
   - Cons: more PRs to sequence and merge in order; cross-domain RLS rules (e.g. providers reading `refill_requests`) need the later domain's migration to reference earlier domains' tables, so ordering discipline matters.
   - Effort: Medium (spread across more units, each individually low-to-medium).
3. **Schema-as-code / CLI-diff generation** (e.g. define target schema declaratively, let `supabase db diff` generate migration SQL) instead of hand-written SQL.
   - Pros: less chance of hand-written SQL drift from the declared schema; regenerable.
   - Cons: adds new tooling to a project with zero tooling/CI today; steeper setup cost for a team that hasn't even chosen a package manager yet; RLS policies still need to be hand-written regardless.
   - Effort: Medium-High (mostly setup cost).

## Recommendation

**Approach 2 (incremental, domain-ordered migrations)**, for two independent reasons: it matches the FK dependency order already validated as correct in `supabase/SPEC.md`, and it's the only approach compatible with the mandatory 400-line review budget given 16 tables' worth of schema + RLS + indexes. Before any migration SQL is written, `sdd-propose` must first resolve the column-level schema gaps (R1/R2) and the core architectural question of service-role-vs-forwarded-JWT for `core-api` (open question #2) — that decision changes what the RLS policies in every subsequent domain migration actually need to do.

## Ready for Proposal

**Conditionally yes** — the exploration surface is complete and the domain/table mapping is fully consistent, but `sdd-propose` should treat "define the missing 8 tables' columns" and "decide core-api's Postgres connection mode (service-role vs. user JWT)" as its first two concrete decisions, not deferred details. `supabase/SPEC.md` is less migration-ready than it looks (half its tables have no columns defined) — proceeding to `sdd-propose` is fine, but the proposal must include schema-definition work, not just "translate existing spec to SQL."
