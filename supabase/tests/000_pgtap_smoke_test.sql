-- Smoke test for Phase 0 (tooling scaffolding): asserts the `pgtap` extension
-- itself loads. Named with a leading `000_` (not `00_`) so it never collides
-- with Phase 1's reserved `00_extensions_enums_test.sql` (batch 00, see
-- tasks.md task 1.4) — this file only proves the test-running tool works,
-- it is not part of any domain batch.
begin;

select plan(1);

select has_extension('pgtap');

select * from finish();

rollback;
