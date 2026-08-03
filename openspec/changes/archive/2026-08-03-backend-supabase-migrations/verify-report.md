## Verification Report

**Change**: backend-supabase-migrations
**Version**: N/A (openspec, no semver)
**Mode**: Standard (Strict TDD inactive — `sdd-init` resolved `strict_tdd: false`; pgTAP via `supabase test db` is the real test layer used and evaluated below)
**Verifier**: independent `sdd-verify` run, fresh context, re-executed all checks rather than trusting prior batch self-reports

---

### Completeness

| Metric | Value |
|--------|-------|
| Tasks total | 77 (Phase 0 through Phase 10, items 0.1–10.5 plus sub-items) |
| Tasks marked `[x]` | 77 |
| Tasks incomplete (`[ ]`) | 0 |
| Commits on `main`, pushed to `origin/main` | 13 (`399679e` .. `3ab279e`), confirmed via `git fetch` — `HEAD` and `origin/main` point to the same commit |
| Working tree | clean (`git status -sb` → nothing to commit) |

Every task 0.1–10.5 is genuinely `[x]` and each phase's narrative note in `tasks.md` (budget accounting, deviations, discoveries) is corroborated by the commit history and file contents below — not just a checkbox claim.

### Build & Tests Execution

**Independent re-run performed in this session** (Docker Desktop and Supabase CLI 2.111.0 were both available — this is NOT a verification gap).

**`supabase db reset`** (full chain from scratch, all 10 migration files + pgtap-enable):
```text
$ supabase db reset
Resetting local database...
Recreating database...
Initialising schema...
Seeding globals from roles.sql...
Applying migration 00000000000000_enable_pgtap.sql...
Applying migration 20260803120000_00_extensions_enums.sql...
Applying migration 20260803120100_01a_identidad_core.sql...
Applying migration 20260803120110_01b_identidad_admin.sql...
Applying migration 20260803120200_02_consumo.sql...
Applying migration 20260803120300_03_catalogo.sql...
Applying migration 20260803120400_04_refill_matching.sql...
Applying migration 20260803120500_05_ofertas.sql...
Applying migration 20260803120600_06_pedidos_pagos.sql...
Applying migration 20260803120700_07_auditoria.sql...
Applying migration 20260803120800_08_storage.sql...
Seeding data from supabase/seed.sql...
Finished supabase db reset on branch main.
```
Result: ✅ clean reset, zero errors, all 10 domain batches + pgtap-enable + seed applied in FK order.

**`supabase test db`**:
```text
000_pgtap_smoke_test.sql ...... ok
00_extensions_enums_test.sql .. ok
01a_identidad_test.sql ........ ok
01b_identidad_test.sql ........ ok
02_consumo_test.sql ........... ok
03_catalogo_test.sql .......... ok
04_refill_matching_test.sql ... ok
05_ofertas_test.sql ........... ok
06_pedidos_pagos_test.sql ..... ok
07_auditoria_test.sql ......... ok
08_storage_test.sql ........... ok
All tests successful.
Files=11, Tests=191,  0 wallclock secs
Result: PASS
```

**Tests**: ✅ 191 passed / 0 failed / 0 skipped — matches the count claimed by every `sdd-apply` batch's self-report exactly. This is an independent confirmation, not a re-trust: full `db reset` + `test db` were re-executed from a fresh session with no prior state.

**Coverage**: ➖ Not applicable — pgTAP has no line-coverage concept; compliance is judged per spec-scenario below (Spec Compliance Matrix).

### Spec Compliance Matrix

| Requirement (spec) | Scenario | Test evidence | Result |
|---|---|---|---|
| db-access-control: Deny-all default | No policy → zero rows | `table_privs_are` on `admin_roles`/`v_auth_orphans` (01b); RLS+revoke-all present on every table (grep-verified, see Correctness) | ✅ COMPLIANT |
| db-access-control: No client-side mutation policies | Direct write rejected | No INSERT/UPDATE/DELETE policy exists anywhere (grep across all 9 domain migrations found zero) | ✅ COMPLIANT |
| db-access-control: No physical DELETE ever | No DELETE grant | `grep -i "grant.*delete"` across all migrations → zero matches (table grants and `storage.objects`) | ✅ COMPLIANT |
| db-access-control: Owner-less child EXISTS pattern | `refill_items`/`offer_items`/`order_items`/`consumption_logs` via EXISTS | 04/05/06/02 test files exercise EXISTS-owner and EXISTS-non-owner scenarios | ✅ COMPLIANT |
| db-schema-identidad: company pending by default, no client status update | New company invisible until approved | `01a_identidad_test.sql` — public-active-only / owner-pending-visible scenarios | ✅ COMPLIANT |
| db-schema-identidad: profiles no client mutation | Direct UPDATE rejected | `01a_identidad_test.sql` "direct profile UPDATE rejected" | ✅ COMPLIANT |
| db-schema-identidad: admin_roles zero client access + bootstrap self-grant | No client access; self-grant valid | `01b_identidad_test.sql` `table_privs_are` + `lives_ok` self-grant | ✅ COMPLIANT |
| auth-provisioning: profiles.id mirrors auth.users.id | FK to auth.users | `01a_identidad_test.sql` `col_is_fk('profiles','id', ...)`; migration has `on delete restrict` | ✅ COMPLIANT |
| auth-provisioning: compensating delete / orphan reconciliation | — | `v_auth_orphans` view existence + service-role-only privileges tested (`01b_identidad_test.sql`); the compensation flow itself is core-api application logic explicitly deferred out of this change's scope (design.md D-1, confirmed in `services/core-api/domains/identidad/SPEC.md`) | ✅ COMPLIANT (DB surface); N/A (app logic out of scope) |
| auth-provisioning: manual bootstrap, no endpoint | Seed script only | `01b_identidad_test.sql` self-grant scenario; runbook documented in `supabase/seed/00_bootstrap_super_admin.sql` and design.md D-5 | ✅ COMPLIANT |
| db-schema-consumo: owner-only SELECT / EXISTS for consumption_logs | Owner sees own only | `02_consumo_test.sql`, 18/18 assertions incl. EXISTS pattern | ✅ COMPLIANT |
| db-schema-consumo: adherence index | `(consumption_id, tomado_at DESC)` used | Index present in migration; test asserts `has_index` (schema-level, not query-plan) | ✅ COMPLIANT (existence); ⚠️ PARTIAL (no `EXPLAIN`-based plan-usage assertion — acceptable for pgTAP scope) |
| db-schema-catalogo: authenticated-only, no anon | anon denied, authenticated allowed | `03_catalogo_test.sql`, 20/20 | ✅ COMPLIANT |
| db-schema-catalogo: provider_catalog public vs owner split | Public sees available only; owner sees all | `03_catalogo_test.sql` public/owner/cross-company scenarios | ✅ COMPLIANT |
| db-schema-catalogo: precio_maximo >= precio_base CHECK | Invalid range rejected | `03_catalogo_test.sql` price CHECK rejection test | ✅ COMPLIANT |
| db-schema-catalogo: catalog_product_id nullable | Insert with NULL succeeds | `03_catalogo_test.sql` nullable insert test | ✅ COMPLIANT |
| db-schema-refill-matching: comuna NOT NULL | Insert without comuna fails | `04_refill_matching_test.sql` `throws_ok` 23502 | ✅ COMPLIANT |
| db-schema-refill-matching: owner-only, provider cannot read directly | Provider denied direct read | `04_refill_matching_test.sql` provider-cannot-read-directly scenario | ✅ COMPLIANT |
| db-schema-refill-matching: refill_items EXISTS pattern | Owner/non-owner | `04_refill_matching_test.sql` EXISTS scenarios | ✅ COMPLIANT |
| db-schema-ofertas: recipient direct compare (not EXISTS) | Proactive offer visible to recipient | `05_ofertas_test.sql` — explicit "recipient B sees their proactive offer (O2, refill_request_id IS NULL)" assertion, passed | ✅ COMPLIANT — this is the change's most safety-critical scenario and it is genuinely tested and passing, not just claimed |
| db-schema-ofertas: at most one aceptada per refill_request | Partial unique index rejects 2nd | `05_ofertas_test.sql` partial-unique-index rejection test | ✅ COMPLIANT |
| db-schema-ofertas: dual-nullable CHECK on offer_items | Both/neither rejected | `05_ofertas_test.sql` `throws_ok` 23514 both scenarios | ✅ COMPLIANT |
| db-schema-ofertas: offers published to Realtime, offer_items not | — | `alter publication supabase_realtime add table public.offers` present; `offer_items` absent from publication (grep-verified) | ✅ COMPLIANT (static); ⚠️ manual 2-session smoke test not executed this session — **accepted, known gap per task instructions (D-4), not re-flagged as new** |
| db-schema-ofertas: displacement to rechazada on accept | — | Documented as core-api use-case responsibility (`services/core-api/domains/ofertas/SPEC.md`), reinforced by DB-level partial unique index as last line of defense; no core-api code exists yet (explicitly out of scope) | ➖ N/A at DB layer — correctly deferred, not a defect |
| db-schema-pedidos-pagos: order_items immutable incl. service_role | UPDATE rejected for every role | `06_pedidos_pagos_test.sql` 32/32, explicit service_role rejection scenario | ✅ COMPLIANT |
| db-schema-pedidos-pagos: payments no client SELECT | Direct read denied | `06_pedidos_pagos_test.sql` "payments zero-SELECT" | ✅ COMPLIANT |
| db-schema-pedidos-pagos: orders/order_items SELECT allowlist | Both parties read; unrelated denied | `06_pedidos_pagos_test.sql` both-parties/unrelated-party scenarios | ✅ COMPLIANT |
| db-schema-pedidos-pagos: no card-data columns | Schema review | `payments` columns grep-verified: no PAN/CVV/expiry columns | ✅ COMPLIANT |
| db-schema-auditoria: entity_id no FK | Insert succeeds without matching parent | `07_auditoria_test.sql` polymorphic insert test | ✅ COMPLIANT |
| db-schema-auditoria: UPDATE/DELETE rejected incl. service_role | — | `07_auditoria_test.sql` explicit service_role 42501 rejection, 10/10 | ✅ COMPLIANT |
| db-schema-auditoria: no direct client access | — | Zero policies + revoke-all, grep-verified | ✅ COMPLIANT |
| storage-buckets: product-images public-read, owner-write | Public GET; cross-company INSERT denied | `08_storage_test.sql` 15/15, anon public SELECT + cross-company INSERT rejection | ✅ COMPLIANT |
| storage-buckets: provider-catalog-uploads private, owner-only, no UPDATE policy | Owner INSERT ok; cross-company SELECT denied | `08_storage_test.sql` owner-path INSERT + cross-company denial; grep confirms zero UPDATE policy on this bucket | ✅ COMPLIANT |
| storage-buckets: no physical DELETE | DELETE fails | `08_storage_test.sql` DELETE rejected for anon/authenticated/service_role; reinforced by pre-existing `protect_objects_delete` trigger (independent discovery, documented) | ✅ COMPLIANT |
| storage-buckets: comprobantes out of scope | No such bucket exists | Only 2 buckets defined (`product-images`, `provider-catalog-uploads`) — grep-verified | ✅ COMPLIANT (accepted scope boundary per Q3, not re-flagged) |

**Compliance summary**: 33/33 applicable scenarios compliant. 1 scenario (adherence index usage) is schema-existence-verified but not plan-verified (acceptable pgTAP limitation, not a defect). 1 scenario (Realtime 2-session smoke test) is a known, accepted, documented manual gap per design.md D-4 — not re-flagged as new per task instructions.

### Correctness (Static Evidence) — targeted spot checks

| Requirement | Status | Notes |
|---|---|---|
| `offers.user_id NOT NULL`, `refill_request_id` nullable | ✅ Implemented | `user_id uuid not null references public.profiles (id)`, `refill_request_id uuid references public.refill_requests (id)` (no `not null`) in `20260803120500_05_ofertas.sql:13-14` |
| `offers` recipient SELECT policy is a direct column compare, not EXISTS | ✅ Implemented | `using (user_id = (select auth.uid()))` — no `EXISTS` involved, confirmed at `20260803120500_05_ofertas.sql:78-82`. This is the exact fix required for proactive offers to remain visible; both the migration and the passing regression test confirm it landed correctly, not just claimed |
| `offer_items` dual-nullable FK + CHECK exactly one | ✅ Implemented | `refill_item_id` and `provider_catalog_item_id` both plain nullable FKs; `constraint offer_items_item_source_check check ((refill_item_id is not null) <> (provider_catalog_item_id is not null))` — correct XOR via `<>` on two booleans |
| `order_items` UPDATE/DELETE revoked from `service_role` too | ✅ Implemented | `revoke update, delete on public.order_items from anon, authenticated, service_role;` (`20260803120600_06_pedidos_pagos.sql:90`) |
| `audit_log` UPDATE/DELETE revoked from `service_role` too | ✅ Implemented | `revoke update, delete on public.audit_log from anon, authenticated, service_role;` (`20260803120700_07_auditoria.sql:42`) |
| `current_company_id()` is `language plpgsql`, not `language sql` | ✅ Implemented | `create function public.current_company_id() returns uuid language plpgsql stable security definer set search_path = '' as $$ begin return (...); end; $$;` (`20260803120000_00_extensions_enums.sql`). The originally-claimed `language sql` bug (which broke `db reset` because `language sql` bodies are resolved at `CREATE FUNCTION` time against a catalog that didn't yet have `profiles`) is confirmed fixed — commit `86a22bd` — and this session's independent `db reset` from scratch succeeded, which is only possible with the `plpgsql` fix in place |
| Deny-all posture: `enable row level security` + `revoke all from anon, authenticated` together | ✅ Implemented (spot-checked 3 domains) | `01a_identidad_core.sql` (companies/company_dispatch_zones/profiles), `02_consumo.sql` (pets/user_consumption/consumption_logs), `04_refill_matching.sql` (refill_requests/refill_items) — all 8 tables checked have both statements present in the same migration as `CREATE TABLE` |
| No table anywhere grants `DELETE` to `anon`/`authenticated` | ✅ Implemented | `grep -rn -i "grant.*delete"` across `supabase/migrations/*.sql` → zero matches; `storage.objects` has an explicit `revoke delete on storage.objects from anon, authenticated` plus no DELETE policy, reinforced by a pre-existing Supabase Storage `protect_objects_delete` trigger |

### Coherence (Design)

| Decision | Followed? | Notes |
|---|---|---|
| D1 (service-role bypass, deny-all + SELECT-only allowlist) | ✅ Yes | Zero INSERT/UPDATE/DELETE client policies anywhere; verified across all 9 domain migrations |
| D-1 (Auth-first + compensation + `ON DELETE RESTRICT` + orphan view) | ✅ Yes | `profiles.id references auth.users(id) on delete restrict`; `v_auth_orphans` view with 15-min grace window and service-role-only grant, matches design.md literally |
| D-2 (single denormalization: `offers.user_id`; EXISTS pattern elsewhere) | ✅ Yes | Confirmed `offers.user_id` is the only denormalized owner column among the 4 "owner-less" tables; `refill_items`/`consumption_logs`/`order_items` all use EXISTS-against-parent |
| D-2 (deny-all = enable RLS + revoke-all, two mechanisms) | ✅ Yes | Confirmed present together on every spot-checked table |
| D-3 (frozen timestamps, fixed 8-section structure, RLS in same file as table) | ✅ Yes | Filenames match design.md's frozen schedule exactly (with the documented, justified `01a`/`01b` split correction); every migration reviewed keeps table + RLS in one file |
| D-4 (Realtime: `offers` only, `REPLICA IDENTITY DEFAULT`, signal not data) | ✅ Yes (static) | `offer_items` confirmed absent from publication; `grant select ... to authenticated` present (required for delivery, matches design.md's explicit warning) |
| D-5 (manual bootstrap runbook, no endpoint) | ✅ Yes | `supabase/seed/00_bootstrap_super_admin.sql` matches the runbook's idempotency/abort/self-grant/audit-log-gated shape from design.md D-5 |
| D-6 (order_items snapshot: copy-by-value, grants-based immutability, `subtotal` not generated) | ✅ Yes | `revoke update, delete ... from ... service_role`; `subtotal numeric(12,2) not null check (subtotal >= 0)` — confirmed not a `GENERATED ALWAYS` column |

### Issues Found

**CRITICAL**: None.

**WARNING**: None.

**SUGGESTION**:
1. `db-schema-consumo`'s adherence-index requirement ("query plan uses the index") is only verified via `has_index` (schema existence), not an `EXPLAIN`-based plan assertion. This is a reasonable pgTAP-scope limitation, not a defect — flagging only as a low-priority follow-up if index-usage regressions ever become a concern (e.g. once real data volume exists).
2. Two supabase `.DS_Store` / local artifact files are present under `supabase/` (`.DS_Store`, `.branches/`, `.temp/`) — already gitignored correctly, no action needed, noting only for hygiene awareness.
3. Consider adding the Realtime 2-session smoke test (D-4) to a follow-up change's checklist once Edge Functions / a real client exist, since it currently has no automation path and relies on a documented manual runbook (this is the already-accepted gap called out in design.md D-4 — restating it here only as a forward-looking suggestion, not a new finding).

### Known Accepted Risks (not re-flagged as findings, per task instructions)

- Realtime's 2-session smoke test (D-4) — manual/undocumented-as-executed, not pgTAP-automatable. Confirmed still the case; not a new defect.
- `Order.items` embed field intentionally absent from `packages/types/SPEC.md` — confirmed `Order` interface has no `items` field (lines 142-149); deliberate scope boundary per PR 8's note, verified consistent.
- "Comprobantes" storage bucket out of scope (Q3) — confirmed absent; only `product-images` and `provider-catalog-uploads` exist.

### Verdict

**PASS**

191/191 pgTAP assertions pass on an independently re-executed `supabase db reset` + `supabase test db` run (not a re-trust of prior batch reports). All 77 tasks (0.1–10.5) are genuinely complete — spot-checked against actual migration SQL, not just checkbox text. All 6 targeted spec-vs-implementation checks from the verification brief (offers RLS direct-compare, offer_items dual-nullable CHECK, order_items/audit_log service_role-inclusive grants, `current_company_id()` plpgsql fix, deny-all two-mechanism posture, zero DELETE grants) are confirmed correctly implemented in the actual migration files. `packages/types/SPEC.md`, `supabase/SPEC.md`, `docs/DATA_MODEL.md`, and both `services/core-api/domains/*/SPEC.md` deltas are present, internally consistent, and match the underlying schema 1:1 where spot-checked (`Offer` interface, `Order` interface, `company_dispatch_zones` in the data model, the `ofertas`/`identidad` domain SPEC deltas). All 13 commits are pushed to `origin/main`; working tree is clean.

**This change is ready for `sdd-archive`.**
