-- Rollback for supabase/migrations/20260803120000_00_extensions_enums.sql.
--
-- Drops only the two shared functions. Do NOT drop `pgcrypto`/`pg_trgm`
-- here: later batches (01a onward) depend on them (`pg_trgm` powers the
-- trigram GIN indexes in batch 03; `pgcrypto` backs `gen_random_uuid()`
-- defaults used across multiple batches' `uuid` primary keys). Dropping the
-- extensions is only safe once every batch from 01a through 08 has been
-- rolled back first, in reverse order, via each batch's own
-- `NN_..._down.sql`. Only then, as a separate manual step (not part of
-- this file):
--   drop extension if exists pg_trgm;
--   drop extension if exists pgcrypto;
drop function if exists public.current_company_id();
drop function if exists public.set_updated_at();
