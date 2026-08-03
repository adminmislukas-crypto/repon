# Tasks: Backend Supabase — migraciones reales, RLS, Storage y Auth

## Review Workload Forecast

| Field | Value |
|---|---|
| Estimated changed lines | ~2,300-2,400 total across 10 chained PRs; per-PR range 60-380 |
| 400-line budget risk | High for `01a_identidad_core`; Medium-High for `05_ofertas`, `06_pedidos_pagos`; Low/Low-Medium for the rest |
| Chained PRs recommended | Yes — 10 sequential PRs, FK-ordered, cannot parallelize |
| Suggested split | PR 0 (tooling) → PR 1 (00) → PR 2 (01a) → PR 3 (01b) → PR 4 (02) → PR 5 (03) → PR 6 (04) → PR 7 (05) → PR 8 (06) → PR 9 (07) → PR 10 (08) |
| Delivery strategy | Not yet decided by user |
| Chain strategy | Not yet decided (stacked-to-main / feature-branch-chain / size-exception) |

```
Decision needed before apply: Yes
Chained PRs recommended: Yes
Chain strategy: pending
400-line budget risk: High
```

### `01_identidad` — line estimate and sub-slice reasoning

Combined single-batch estimate (`companies`, `company_dispatch_zones`, `profiles`, `admin_roles` + all enums/RLS/triggers/grants + rollback + pgTAP + both SPEC.md deltas): **~455-480 lines** → over budget.

**Correction to design.md's illustrative filenames**: design.md's example split (`01a_identidad_companies` / `01b_identidad_profiles`, i.e. companies-only vs profiles-only) does not work. `companies`' owner-visibility SELECT policy is `EXISTS (... FROM profiles p WHERE p.id = auth.uid() AND p.company_id = companies.id)` — it requires `profiles` to already exist when the policy is created (policy bodies are validated against the catalog at `CREATE POLICY` time, unlike SQL function bodies). Conversely `profiles.company_id` FKs to `companies`, so `profiles` can't ship first either. This is a genuine circular RLS/FK coupling, not an artifact of poor design — it's why the identity batch resists a clean split by "which table" alone.

**Recommended split** (same frozen timestamps design.md reserved, corrected content boundary):
- `20260803120100_01a_identidad_core.sql` — `companies` + `company_dispatch_zones` + `profiles` together. D-3's fixed internal file order creates *all* tables (step 2) before *any* RLS policy (step 7), so the cross-reference resolves inside one migration file. **Est. ~350-380 lines. High/borderline** — watch actual diff at PR time.
- `20260803120110_01b_identidad_admin.sql` — `admin_roles` (FK to already-merged `profiles`) + `v_auth_orphans` view (D-1) + bootstrap runbook (D-5). Clean forward dependency only. **Est. ~180-200 lines. Low-Medium.**

**Recommendation: split, using the corrected boundary above** (not design.md's companies/profiles split). It resolves the circular dependency without bending D-3's "a table never exists without its RLS in the same commit" rule — both sub-slices remain internally complete.

### Per-batch estimate

| Batch | Est. lines | Risk |
|---|---|---|
| 0 tooling scaffolding | n/a (config only) | — |
| 00 extensions_enums | 60-90 | Low |
| 01a identidad_core | 350-380 | **High** |
| 01b identidad_admin | 180-200 | Low-Medium |
| 02 consumo | 260-300 | Medium |
| 03 catalogo | 230-260 | Low-Medium |
| 04 refill_matching | 220-250 | Low-Medium |
| 05 ofertas | 280-320 | Medium-High (dual-nullable CHECK, 2 policies, Realtime, partial unique index) |
| 06 pedidos_pagos | 300-340 | Medium-High (immutability trigger, 3 tables, PCI notes) |
| 07 auditoria | 150-180 | Low |
| 08 storage | 150-200 | Low-Medium |

### Suggested Work Units

| Unit | Goal | PR | Notes |
|---|---|---|---|
| 0 | CLI + pgTAP scaffolding | PR 0 | No base; blocks all others |
| 1 | Batch 00 | PR 1 | Base: PR 0 |
| 2 | Batch 01a | PR 2 | Base: PR 1; budget-critical |
| 3 | Batch 01b | PR 3 | Base: PR 2 |
| 4 | Batch 02 | PR 4 | Base: PR 3 |
| 5 | Batch 03 | PR 5 | Base: PR 4 |
| 6 | Batch 04 | PR 6 | Base: PR 5 |
| 7 | Batch 05 | PR 7 | Base: PR 6; watch budget |
| 8 | Batch 06 | PR 8 | Base: PR 7; watch budget |
| 9 | Batch 07 | PR 9 | Base: PR 8 |
| 10 | Batch 08 | PR 10 | Base: PR 9; closes the change |

---

## Phase 0: Tooling Scaffolding (task-zero)

- [x] 0.1 `supabase init` at repo root → commit `supabase/config.toml`; pin CLI version (root note or `.tool-versions`). Done: ran real `supabase init --yes` (CLI 2.111.0 installed via `brew install supabase`, not hand-authored). Pinned in root `.tool-versions`.
- [x] 0.2 Create `supabase/migrations/`, `supabase/rollback/`, `supabase/tests/`, `supabase/seed/`. Done: `rollback/` and `seed/` got `.gitkeep`; `migrations/` (pre-existing, was untracked/empty) also got `.gitkeep`; `tests/` has a real file so no placeholder needed.
- [x] 0.3 Enable pgTAP via `supabase test db` config; add a smoke test asserting the `pgtap` extension loads. Done: `create extension if not exists pgtap` must live in a real migration (not inside a test file's own `begin...rollback`), added as `supabase/migrations/00000000000000_enable_pgtap.sql` (epoch-zero timestamp, runs before all domain batches) + rollback `supabase/rollback/00_pgtap_down.sql` + smoke test `supabase/tests/000_pgtap_smoke_test.sql` asserting `has_extension('pgtap')`. Verified via Supabase's own docs (fetched live) that `create extension if not exists pgtap with schema extensions;` is the documented explicit step — not implicitly auto-enabled. Not verified end-to-end against a running local stack (Docker daemon not available in this sandbox) — flagged as a risk.
- [x] 0.4 Add `.gitignore` entries for local Supabase artifacts (`.branches/`, `.temp/`). Done: root `.gitignore` appended (`supabase/.branches/`, `supabase/.temp/`); `supabase/.gitignore` was also auto-generated by `supabase init` with `.branches`/`.temp` already present — both kept, not duplicative (different path scoping).
- [x] 0.5 Document the per-batch DoD (migration + rollback + pgTAP test + types delta + spec delta, one commit) at the top of `supabase/SPEC.md`. Done: inserted `## Definition of Done — por lote de migración` section right after the intro paragraph, before `## Tablas`, without disturbing existing structure.

## Phase 1: Batch 00 — extensions + shared functions

Spec: `db-access-control`

- [x] 1.1 `supabase/migrations/20260803120000_00_extensions_enums.sql`: `pgcrypto`, `pg_trgm`; `public.set_updated_at()` trigger fn (D-3); `public.current_company_id()` SECURITY DEFINER fn (D-2). Done.
- [x] 1.2 No enum here: no enum is cross-domain in the finalized specs — each domain's enum ships inside its own batch (D-3 internal order). Do not invent shared enums to match the filename. Confirmed: file contains no enum.
- [x] 1.3 `supabase/rollback/00_extensions_enums_down.sql`: drop both functions; document extensions are only safe to drop once every later batch is rolled back too. Done.
- [x] 1.4 `supabase/tests/00_extensions_enums_test.sql`: extensions installed; both functions exist with correct security/volatility. Done: 11 pgTAP assertions (`has_extension` x2, `has_function`/`function_lang_is`/`function_returns`/`volatility_is` for `set_updated_at()`, plus `is_definer` for `current_company_id()`). Not verified end-to-end against a running local stack (Docker daemon unavailable in this sandbox, same caveat as Phase 0 task 0.3) — flagged as a risk.
- [x] 1.5 `supabase/SPEC.md` delta: document both primitives as cross-cutting conventions. Done: new `## Primitivas transversales (lote 00)` section inserted before `## Tablas`.

## Phase 2: Batch 01a — identidad core (companies, dispatch zones, profiles)

Spec: `db-schema-identidad`, `db-access-control`

- [x] 2.1 `20260803120100_01a_identidad_core.sql`: enums `company_status`, `role`, `profile_status`; tables `companies`, `company_dispatch_zones`, `profiles`; FKs (`profiles.id → auth.users.id` RESTRICT per D-1; `profiles.company_id → companies` nullable; `company_dispatch_zones.company_id → companies`); UNIQUE(`rut`), UNIQUE(`company_id`,`comuna`). Done.
- [x] 2.2 Indexes; `updated_at` triggers on `companies`, `profiles`. Done: `companies_status_idx`, partial `profiles_company_id_idx`; `set_updated_at()` triggers on both.
- [x] 2.3 RLS: enable + revoke-all on all three; grants (`select` to `authenticated`); policies — `companies` (public-active + owner-pending via EXISTS on `profiles`), `company_dispatch_zones` (inherits `companies` visibility), `profiles` (owner-only `id = auth.uid()`). Done.
- [x] 2.4 `supabase/rollback/01a_identidad_down.sql`. Done — flags an unverified open risk re: `current_company_id()`'s dependency on `profiles` (same Docker-unavailable caveat as 0.3/1.4).
- [x] 2.5 `supabase/tests/01a_identidad_test.sql`: schema + all identidad RLS scenarios (public sees active only, owner sees own pending company, profile owner-only read, direct profile UPDATE rejected). Done: 20 pgTAP assertions. Not verified end-to-end against a running local stack (Docker daemon unavailable in this sandbox, same caveat as 0.3/1.4) — flagged as a risk.
- [x] 2.6 `packages/types/SPEC.md` delta: add `Company`, `CompanyDispatchZone` interfaces. Done.
- [x] 2.7 `supabase/SPEC.md` delta: real columns for `companies`; add `company_dispatch_zones`; correct `profiles` RLS row (owner SELECT-only, flags conflict with current prose). Done — conflict flagged in-place, not silently overwritten.
- [x] 2.8 `docs/DATA_MODEL.md` delta: add `company_dispatch_zones` to the relationship map. Done.

**NOT YET COMMITTED.** All 6 artifact files (2.1-2.8) are written and correct on disk, but `git diff --cached --numstat` measured **385 insertions + 20 deletions = 405 changed lines**, over the ~400-line review budget and above the 350-380 forecast in the Review Workload Forecast above. Per this batch's explicit budget-stop instruction, apply halted before committing to report the actual count back rather than commit an oversized PR or silently re-split further. Awaiting a decision (trim further / accept as `size:exception` / other) before the commit lands.

## Phase 3: Batch 01b — identidad admin (admin_roles, orphan view, bootstrap)

Spec: `db-schema-identidad`, `auth-provisioning` (D-1, D-5)

- [x] 3.1 `20260803120110_01b_identidad_admin.sql`: enum `admin_role`; table `admin_roles` (self-reference exception documented via `comment on column`); `v_auth_orphans` view (D-1), `revoke all ... grant select ... to service_role`. Done: view placed between sections 2 and 3 (no dedicated slot in the fixed 8-section structure), documented inline why.
- [x] 3.2 RLS: enable + revoke-all on `admin_roles`, zero policies. Done — same file as 3.1 (section 6/7).
- [x] 3.3 `supabase/seed.sql`: dev-local bootstrap admin (runs on `supabase db reset`). Done: fixed UUID + fixed password, self-grants `super_admin`, uses `extensions.crypt`/`extensions.gen_salt` (pgcrypto lives in the `extensions` schema per batch 00).
- [x] 3.4 `supabase/seed/00_bootstrap_super_admin.sql`: parametrized staging/prod runbook (D-5), idempotent, aborts if a `super_admin` exists, writes first `audit_log` row. Done — with one deviation: the `audit_log` insert is written but commented out with an explicit note, because `public.audit_log` doesn't exist until batch 07 (Phase 9); shipping it live here would break the script against every environment before then. Both real inserts are gated by `where not exists (select 1 from admin_roles where rol = 'super_admin')` per D-5's abort rule.
- [x] 3.5 `supabase/rollback/01b_identidad_down.sql`. Done.
- [x] 3.6 `supabase/tests/01b_identidad_test.sql`: zero client access to `admin_roles`; bootstrap self-grant FK scenario; `v_auth_orphans` service-role-only. Done: 14 pgTAP assertions (schema, `table_privs_are` for anon/authenticated/service_role, `lives_ok` self-grant, `throws_ok` 42501 direct read). Not verified end-to-end against a running local stack (Docker daemon unavailable in this sandbox, same caveat as 0.3/1.4/2.5) — flagged as a risk.
- [x] 3.7 `services/core-api/domains/identidad/SPEC.md` delta: `AuthProvider` compensation contract (D-1: deterministic-failure delete vs ambiguous-failure forward-recovery). Done: added `deleteAccount`/`findAccountByEmail` to the port interface plus a new prose subsection.
- [x] 3.8 `supabase/SPEC.md` delta: admin bootstrap runbook reference; `admin_roles` RLS row (zero client access). Done: also added a `## Columnas reales — lote 01b` section (admin_roles + v_auth_orphans) per D-3's DoD, and split the combined `admin_roles`/`audit_log` RLS row into two (admin_roles migrado, audit_log pendiente lote 07).

## Phase 4: Batch 02 — consumo

Spec: `db-schema-consumo`

- [x] 4.1 `20260803120200_02_consumo.sql`: physical `user_id NOT NULL` on `pets`/`user_consumption`; table `consumption_logs`; index `(consumption_id, tomado_at DESC)`. Done: `pets.user_id`/`user_consumption.user_id` REFERENCES `profiles(id)`; `owner_type`/`consumption_kind` enums; `user_consumption.pet_id` nullable FK to `pets`; `dosis_por_toma`/`stock_actual`/`peso_kg` as plain `numeric` (unbounded, not money) and `frecuencia_dias` as `integer` (day count) — deliberate deviation from the generic `numeric(12,2)` type-mapping convention since these aren't currency fields, documented inline in the migration.
- [x] 4.2 RLS: enable+revoke-all on all three; owner-only SELECT on `pets`/`user_consumption`; `consumption_logs` via EXISTS on `user_consumption.user_id`. Done.
- [x] 4.3 `updated_at` triggers on `pets`, `user_consumption`. Done: `public.set_updated_at()`, same as lote 01a. `consumption_logs` has no `updated_at` (append-only).
- [x] 4.4 `supabase/rollback/02_consumo_down.sql`. Done.
- [x] 4.5 `supabase/tests/02_consumo_test.sql`: owner-only scenarios; EXISTS-pattern for `consumption_logs`; index-usage assertion for the adherence query. Done: 18 pgTAP assertions. **Verified end-to-end against a real local Supabase/Postgres stack** (Docker available this session) — `supabase test db` → `02_consumo_test.sql ... ok` (18/18).
- [x] 4.6 `packages/types/SPEC.md` delta: add `ConsumptionLog` interface (Pet/UserConsumption already fixed). Done: `{ id, consumptionId, tomadoAt, cantidad? }`. Deliberately omits `createdAt` (physical-only audit column) — same convention as `Company`/`Profile`, documented as a new bullet in "Reglas de validación".
- [x] 4.7 `supabase/SPEC.md` delta: real columns for `pets`, `user_consumption`, `consumption_logs`. Done — also updated the `pets`/`user_consumption`/`consumption_logs` row in "Row Level Security — reglas por tabla" (split into two rows: owner-only vs EXISTS-via-parent, marked migrado).

**CRITICAL discovery, out of Phase 4 scope, blocking full-chain verification — UPDATE: fixed and committed separately.** Running `supabase db reset` for the first time against a real Postgres instance in this session (Docker was unavailable for PRs 0-3, so this was never actually exercised) initially failed inside **already-committed batch 00** (`20260803120000_00_extensions_enums.sql`, commit `a32d8ff`) with `ERROR: relation "public.profiles" does not exist` when creating `public.current_company_id()`. The migration's original comment claimed "a `language sql` function body is not validated against the catalog at `CREATE FUNCTION` time, only at first invocation" — **this was factually wrong**: Postgres parses and semantically resolves `language sql` function bodies at creation time (to determine the result projection), unlike `language plpgsql`, whose embedded queries are only resolved lazily at first call. This broke the entire migration chain (00→01a→01b→02→...) for anyone running a real `supabase db reset`/`db push`, not a false-negative from this batch. Superseding the earlier plan to leave this unfixed and revert a local diagnostic patch: **the fix was ultimately committed** as `86a22bd fix(supabase): current_company_id() must be plpgsql, not sql` (changes `public.current_company_id()` to `language plpgsql` in the batch-00 migration, updates `supabase/SPEC.md`'s primitive-table row, and updates `00_extensions_enums_test.sql`'s `function_lang_is` assertion accordingly). A full `supabase db reset` + `supabase test db` run across all five test files (000, 00, 01a, 01b, 02) now passes **64/64 pgTAP assertions**, confirming the whole chain 00→01a→01b→02 is sound end-to-end, not merely unverified. This closes the "Docker unavailable, not verified" caveats previously noted on tasks 0.3/1.4/2.5/3.6/4.5.

**Process note — concurrent apply execution detected.** During this Phase 4 apply run, an independent second execution of the same slice was found to have committed to this repository mid-session (commits `7ba0922` and `86a22bd` above), without this run initiating either. Both implementations independently converged on an equivalent migration/rollback/test/spec-delta shape and both verified 18/18 (`02_consumo_test.sql`) against a real Docker/pgTAP stack. This run's own in-progress edit to `packages/types/SPEC.md` (adding the `ConsumptionLog` interface) briefly produced a duplicate `interface ConsumptionLog` block colliding with the concurrent commit's identical addition; by the time this was checked, the working tree was already clean and de-duplicated against `86a22bd` (no diff), so no corruption persisted and no further action was needed. Flagging as a risk regardless: **the orchestrator should confirm only one `sdd-apply` execution is dispatched per PR slice** — an uncaught duplicate landing could corrupt `packages/types/SPEC.md` with an invalid double interface declaration in a less lucky timing window.

## Phase 5: Batch 03 — catalogo

Spec: `db-schema-catalogo`

- [x] 5.1 `20260803120300_03_catalogo.sql`: enum `catalog_product_status`; tables `catalog_products`, `provider_catalog` (nullable `catalog_product_id`; CHECK `precio_maximo >= precio_base`); trigram GIN indexes. Done: 4 GIN trigram indexes total (`nombre`/`categoria` on each table, schema-qualified `extensions.gin_trgm_ops`); `precio_base >= 0` and `stock >= 0` CHECKs added too (in spec table, not explicitly listed here).
- [x] 5.2 RLS: `catalog_products` authenticated-only SELECT (no `anon`); `provider_catalog` two policies (public `disponible=true`; owner sees all via EXISTS on `profiles.company_id`). Done: EXISTS literal against `profiles` (not `current_company_id()`) — same choice 01a made for `companies_authenticated_select_owner`, and the spec documents the literal EXISTS predicate.
- [x] 5.3 `updated_at` triggers on both. Done.
- [x] 5.4 `supabase/rollback/03_catalogo_down.sql`. Done — verified by actually running it against the live local stack (`psql -f`), not just written.
- [x] 5.5 `supabase/tests/03_catalogo_test.sql`: anon-denied; public-vs-owner visibility; price CHECK rejection; nullable `catalog_product_id` insert succeeds. Done: 20 pgTAP assertions. **Verified end-to-end against a real local Supabase/Postgres stack** — `supabase db reset` (full chain 00→01a→01b→02→03) then `supabase test db` → `03_catalogo_test.sql ... ok` (20/20, 84/84 across all files).
- [x] 5.6 `packages/types/SPEC.md` delta: add `CatalogProduct`, `ProviderCatalogItem` interfaces. Done: also added `CatalogProductStatus` union type and two validation-rule bullets.
- [x] 5.7 `supabase/SPEC.md` delta: real columns; Q6 rationale note (authenticated-only). Done — also corrected the `provider_catalog` RLS summary row (previously said "editable by owning profile", actually SELECT-only in this batch; conflict flagged in-place, not silently overwritten, same pattern as lote 01a's `profiles` row) and added a `catalog_products` row.

## Phase 6: Batch 04 — refill-matching

Spec: `db-schema-refill-matching`

- [x] 6.1 `20260803120400_04_refill_matching.sql`: physical `user_id NOT NULL`, `comuna NOT NULL` on `refill_requests`; table `refill_items` (`catalog_product_id` nullable FK). Done: enums `refill_urgencia`/`refill_estado`; `estado` DEFAULT `'abierta'`; indexes `refill_requests_user_id_idx`/`refill_items_refill_request_id_idx`.
- [x] 6.2 RLS: `refill_requests` owner-only SELECT; `refill_items` via EXISTS on `refill_requests.user_id`. Done — same file, section 7.
- [x] 6.3 `updated_at` trigger on `refill_requests`. Done: `public.set_updated_at()`, same as prior lotes. `refill_items` has no `updated_at` (immutable once created, same pattern as `consumption_logs`/`order_items`).
- [x] 6.4 `supabase/rollback/04_refill_matching_down.sql`. Done.
- [x] 6.5 `supabase/tests/04_refill_matching_test.sql`: `comuna` NOT NULL rejection; owner-only; provider-cannot-read-directly; EXISTS for `refill_items`. Done: 19 pgTAP assertions (schema, anon-zero-privileges, `throws_ok` 23502 comuna NOT NULL, `lives_ok` nullable `catalog_product_id`, owner-sees-own, provider-cannot-read-directly, EXISTS owner/non-owner on `refill_items`). **Verified end-to-end against a real local Supabase/Postgres stack** — `supabase db reset` (full chain 00→01a→01b→02→03→04) then `supabase test db` → `04_refill_matching_test.sql ... ok` (19/19).
- [x] 6.6 `packages/types/SPEC.md` delta: add `comuna` to `RefillRequest`; add `catalogProductId?` to `RefillItem`. Done — also added two validation-rule bullets (comuna required, catalogProductId optional/Q4).
- [x] 6.7 `supabase/SPEC.md` delta: correct "zona de despacho" RLS prose (Q2 — matching is core-api's job, not RLS); real columns. Done — conflict flagged in-place (same pattern as lotes 01a/03), not silently overwritten.

## Phase 7: Batch 05 — ofertas

Spec: `db-schema-ofertas`

- [x] 7.1 `20260803120500_05_ofertas.sql`: enum `offer_status`; table `offers` (`user_id NOT NULL` recipient, `refill_request_id` nullable, partial unique `(refill_request_id) WHERE status='aceptada'`); table `offer_items` (`refill_item_id`/`provider_catalog_item_id` dual-nullable + CHECK exactly-one). Done — also adds enum `offer_kind` (not named explicitly in this task's text, but required physically: `Offer.kind` is a column fixed by the `Offer` type in `packages/types/SPEC.md`, same enum↔union-type convention as every other lote).
- [x] 7.2 RLS: `offers` two policies (recipient via direct `user_id` compare; provider via EXISTS on `profiles.company_id`); `offer_items` via EXISTS on `offers.user_id`. Done — provider policy uses the literal EXISTS-against-`profiles` pattern (same as `companies`/`provider_catalog`, lotes 01a/03), per `db-schema-ofertas` spec.md's literal wording, not `design.md`'s illustrative `current_company_id()` snippet.
- [x] 7.3 Realtime: `alter publication supabase_realtime add table public.offers`; `grant select ... to authenticated` (required for delivery). Done.
- [x] 7.4 `updated_at` trigger on `offers`. Done. `offer_items` has no `updated_at` (immutable once created, same pattern as `refill_items`/`consumption_logs`).
- [x] 7.5 `supabase/rollback/05_ofertas_down.sql`. Done — verified by actually running it against the live local stack (`psql -f`), including `alter publication supabase_realtime drop table public.offers` before dropping the table.
- [x] 7.6 `supabase/tests/05_ofertas_test.sql`: recipient/provider visibility incl. proactive-offer-no-refill_request; partial-unique-index rejection; dual-nullable CHECK (both/neither rejected); reactive vs proactive item-source scenarios. Done: 31 pgTAP assertions. **Verified end-to-end against a real local Supabase/Postgres stack** — `supabase db reset` (full chain 00→01a→01b→02→03→04→05) then `supabase test db` → `05_ofertas_test.sql ... ok` (31/31, 134/134 across all 8 files). The critical regression scenario — a proactive offer (`refill_request_id IS NULL`) visible to its recipient via the direct `user_id` compare — passed explicitly (`'recipient B sees their proactive offer (O2, refill_request_id IS NULL) -- proves visibility does NOT depend on refill_requests'`).
- [x] 7.7 Manual smoke test doc (D-4, two sessions: owner receives, non-owner doesn't) recorded in `supabase/SPEC.md` — not automatable via pgTAP. Done: 5-step runbook under "Realtime (D-4)", including a proactive-offer repeat of the same flow. Not executed in this session (requires two live authenticated Realtime sessions, outside `supabase test db`'s reach) — flagged as an open risk, same category as the Docker-unavailable caveats on earlier lotes before Docker became available.
- [x] 7.8 `packages/types/SPEC.md`: verify only — `Offer.userId`/`OfferItem` dual-optional FKs already correct, no further change per this change's scope. Done: confirmed both interfaces need no structural change. One prose correction made (not a structural change): the `OfferStatus` validation-rule bullet said "Pendiente de definir en `sdd-spec`" about what triggers `'rechazada'` — that question is now resolved by `db-schema-ofertas` (the displacement use case), so the stale "pending" note was updated to reflect the resolution, per this batch's instruction to flag/fix genuine gaps rather than invent silently.
- [x] 7.9 `services/core-api/domains/ofertas/SPEC.md` delta: `offers.user_id` invariant vs `refill_requests.user_id`; displacement-to-`rechazada` use case on `aceptarOferta`. Done — two new subsections added after the existing use-case block.
- [x] 7.10 `supabase/SPEC.md` delta: real columns; Realtime publication note; RLS allowlist. Done — also corrected the `offers`/`offer_items` RLS summary row (previously vague "provider edits/user reads" prose, actually read-only client + two-policy split; conflict flagged in-place, same pattern as lotes 01a/03/04).

**Budget resolved by comment-trim pass.** The initial artifacts for 7.1-7.10 measured 497 insertions + 2 deletions = 499 changed lines, over the ~400-line review budget. Rather than splitting `offers`/`offer_items` across files (which would violate D-3 — a table's RLS must land in the same commit — and had no reserved timestamp sub-slot for this batch), the migration, rollback, and test files were trimmed of decorative/repetitive prose (verbose `comment on table/column` paragraphs collapsed to one line each, cross-reference comments cut, section banners collapsed) while preserving every schema decision, RLS policy, grant, index, enum, and all 31 pgTAP assertions verbatim. Re-verified end-to-end after trimming: `supabase db reset` (full chain 00→01a→01b→02→03→04→05) then `supabase test db` → `05_ofertas_test.sql ... ok` (31/31, 134/134 across all 8 files), including the critical proactive-offer recipient-visibility regression case. Final diff: **382 insertions + 2 deletions = 384 changed lines**, under budget.

## Phase 8: Batch 06 — pedidos-pagos

Spec: `db-schema-pedidos-pagos`

- [x] 8.1 `20260803120600_06_pedidos_pagos.sql`: table `orders` (physical `offer_id`/`user_id`/`company_id`); table `order_items` (snapshot columns + CHECKs, no `updated_at`); enum `payment_status`; table `payments` (CHECK `gateway IN (...)`, no card-data columns). Done: also adds enum `order_status` (`'confirmado'|'preparando'|'en_camino'|'entregado'`, not named explicitly in this task's text but required physically since it's `Order.status`'s fixed union type — same enum↔union-type convention as `offer_kind` in lote 05).
- [x] 8.2 Immutability mechanism for `order_items` `UPDATE`, every role including service-role (D-6). Done: **grants-based** (`revoke update, delete on public.order_items from anon, authenticated, service_role`), not a trigger — matches design.md D-6's own literal choice and the same mechanism reserved for `audit_log` (lote 07), since `service_role` has `BYPASSRLS` and only grants stop it.
- [x] 8.3 RLS: `orders` owner+company SELECT (two policies, same literal `EXISTS`-against-`profiles` pattern as `offers`/`companies`); `order_items` via EXISTS on `orders.user_id` only (owner-only, same carve-out `offer_items` used for providers — not company); `payments` zero client SELECT policy. Done.
- [x] 8.4 `updated_at` triggers on `orders`, `payments`. Done: `public.set_updated_at()`, same as all prior lotes. `order_items` has no trigger (immutable).
- [x] 8.5 `supabase/rollback/06_pedidos_pagos_down.sql`. Done — verified by actually running it against the live local stack (`psql -f`).
- [x] 8.6 `supabase/tests/06_pedidos_pagos_test.sql`: UPDATE rejected for every role incl. service-role; both-parties-read; unrelated-party-denied; no card columns; `payments` zero-SELECT. Done: 32 pgTAP assertions. **Verified end-to-end against a real local Supabase/Postgres stack** — `supabase db reset` (full chain 00→01a→01b→02→03→04→05→06) then `supabase test db` → `06_pedidos_pagos_test.sql ... ok` (32/32, 166/166 across all 9 files). The critical D-6 scenario — `UPDATE order_items` rejected with `42501` for both `authenticated` AND `service_role` — passed explicitly.
- [x] 8.7 `packages/types/SPEC.md` delta: add `OrderItem`, `Payment` interfaces. Done: also adds `PaymentStatus` union type. `Order` itself left untouched (out of this task's explicit scope) — no `items: OrderItem[]` field added, unlike `Offer`/`RefillRequest`'s embedded-array convention, to avoid silently re-opening a type `sdd-spec` already fixed.
- [x] 8.8 `supabase/SPEC.md` delta: real columns; snapshot-immutability note. Done: new "Columnas reales — lote `06`" section; corrected the `orders`/`payments` RLS summary row (previously vague "visible solo para el usuario y el proveedor" prose, actually two-policy owner+company on `orders` and zero-access on `payments`; conflict flagged in-place, same pattern as lotes 01a/03/04/05).
- [x] 8.9 `docs/DATA_MODEL.md` delta: `order_items` snapshot-semantics note (D-6). Done.

**Budget**: migration 131 + rollback 8 + test 157 = 296 lines for the 3 SQL artifacts (vs. 300-340 forecast for the whole batch, already under). Full diff incl. the 3 spec-delta files measured via `git diff --stat` before committing (see apply-progress).

## Phase 9: Batch 07 — auditoria

Spec: `db-schema-auditoria`

- [x] 9.1 `20260803120700_07_auditoria.sql`: table `audit_log` (`entity_id uuid`, no FK — polymorphic). Done.
- [x] 9.2 RLS enable + revoke-all; grants `insert`,`select` to `service_role` only; explicit `revoke update, delete` from `anon, authenticated, service_role`. Done — same grants-based mechanism as `order_items` (D-6).
- [x] 9.3 `supabase/rollback/07_auditoria_down.sql`. Done.
- [x] 9.4 `supabase/tests/07_auditoria_test.sql`: service-role UPDATE/DELETE rejected; direct client read denied; polymorphic insert succeeds without FK. Done: 10 pgTAP assertions. **Verified end-to-end against a real local Supabase/Postgres stack** — see verification note below.
- [x] 9.5 `packages/types/SPEC.md` delta: add `AuditLog` interface. Done.
- [x] 9.6 `supabase/SPEC.md` delta: real columns; append-only grants note. Done.

**Batch verified end-to-end.** `supabase db reset` (full chain 00→01a→01b→02→03→04→05→06→07) then `supabase test db` → `07_auditoria_test.sql ... ok` (10/10, 176/176 across all 10 files). The critical D-6 scenario — `service_role` UPDATE and DELETE on `audit_log` both rejected with `42501` despite `BYPASSRLS` — passed explicitly, same pattern as `order_items` in lote 06. Rollback (`07_auditoria_down.sql`) also verified by actually running it against the live local stack (`psql -f`), then re-running `supabase db reset` to restore the full chain before committing. Migration 50 + rollback 2 + test 83 = 135 lines for the 3 SQL artifacts, well under the 150-180 forecast for the whole batch.

## Phase 10: Batch 08 — storage

Spec: `storage-buckets`

- [x] 10.1 `20260803120800_08_storage.sql`: buckets `product-images` (public-read), `provider-catalog-uploads` (private); `storage.objects` policies (owner-path-prefix INSERT/UPDATE both; private SELECT for `provider-catalog-uploads` owner only); no client DELETE on either. Done — with one deviation from the finalized `storage-buckets` spec.md (not this task's own paraphrase): `provider-catalog-uploads` gets **no `UPDATE` policy at all** (spec.md Requirement "provider-catalog-uploads bucket is private, owner-only": "No client UPDATE/DELETE policy — re-uploads create new objects"), only `product-images` has owner INSERT+UPDATE. `storage.objects` is owned by `supabase_storage_admin`, not created here; RLS ships already enabled by the Storage service (verified — `alter table ... enable row level security` fails for the migration role with "must be owner of table objects", so it's intentionally omitted, not run).
- [x] 10.2 `supabase/rollback/08_storage_down.sql`: drop policies, drop buckets. Done — both `storage.objects` and `storage.buckets` carry a pre-existing `BEFORE DELETE` trigger (`protect_objects_delete`/`protect_buckets_delete`) that rejects direct `DELETE` unless `storage.allow_delete_query` is set for the session; the rollback sets it before its own cleanup deletes. Verified by actually running it against the live local stack (`psql -f`), then re-running `supabase db reset` to restore the full chain before committing.
- [x] 10.3 `supabase/tests/08_storage_test.sql`: cross-company path-prefix rejection both buckets; public GET works unauthenticated; no DELETE grant. Done: 15 pgTAP assertions (bucket `public` flag both buckets, exact policy set via `policies_are`, owner-path INSERT success + cross-company INSERT rejection for both buckets, anon public SELECT on `product-images`, anon/cross-company SELECT denial on `provider-catalog-uploads`, DELETE rejected for `anon`/`authenticated`/`service_role`). **Verified end-to-end against a real local Supabase/Postgres stack** — `supabase db reset` (full chain 00→...→08, all 10 batches) then `supabase test db` → `08_storage_test.sql ... ok` (15/15, **191/191 across all 11 test files** — the full chain's final proof).
- [x] 10.4 `packages/types/SPEC.md`: no change (buckets aren't row types). Confirmed — grepped for any storage-related content, none exists, nothing to add.
- [x] 10.5 `supabase/SPEC.md` delta: bucket list + policies; note comprobantes buckets are explicitly out of scope (Q3). Done: new `## Storage — buckets y políticas (lote 08)` section (bucket/policy table, no-DELETE rationale incl. the `protect_objects_delete` trigger discovery, explicit Q3 out-of-scope note), inserted before `## Bootstrap de administrador`.

**Batch verified end-to-end — closes the migration chain.** `supabase db reset` (full chain 00→01a→01b→02→03→04→05→06→07→08) then `supabase test db` → **191/191 pgTAP assertions pass across all 11 test files** (000 smoke + 00 through 08). Two real-stack discoveries not anticipated by the finalized spec/design, both fixed in this batch: (1) the migration role (`postgres`) is not the owner of `storage.objects`/`storage.buckets` (owned by `supabase_storage_admin`) and cannot run `ALTER TABLE ... ENABLE ROW LEVEL SECURITY` on them — omitted since RLS is already enabled by the Storage service; `CREATE POLICY`/`REVOKE`/`GRANT` remain permitted for `postgres` on this table regardless; (2) both `storage.objects` and `storage.buckets` carry a `BEFORE DELETE FOR EACH STATEMENT` trigger (`storage.protect_objects_delete`/`storage.protect_buckets_delete` → `storage.protect_delete()`) that rejects direct `DELETE` with `42501` unconditionally (regardless of role/grant, incl. `BYPASSRLS` roles) unless `storage.allow_delete_query` is set — this independently reinforces the no-physical-delete requirement and required the rollback script to set that session GUC before its own cleanup deletes.

---

## Dependency Notes

Batches are strictly **sequential** — frozen timestamps encode the FK-dependency chain (D-3); no batch after 00 can be parallelized against another. Within each batch, the 5 DoD artifacts (migration, rollback, test, types delta, spec delta) land in the **same commit/PR** per D-3 — writing the pgTAP test depends on final column names, so artifacts are authored together, not split across parallel workers. Phase 0 (tooling) is a hard prerequisite for every subsequent phase.
