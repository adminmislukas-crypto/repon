-- pgTAP test for supabase/migrations/20260803120000_00_extensions_enums.sql.
--
-- Asserts the two shared extensions are installed, and both cross-cutting
-- functions exist with the correct language/return type/security/volatility
-- attributes documented in design.md D-2 and D-3.
begin;

select plan(11);

-- Extensions
select has_extension('pgcrypto', 'pgcrypto extension is installed');
select has_extension('pg_trgm', 'pg_trgm extension is installed');

-- public.set_updated_at() — plpgsql trigger fn, one implementation shared
-- by every table with `updated_at` in every later batch (design.md D-3)
select has_function('public', 'set_updated_at', array[]::text[], 'public.set_updated_at() exists');
select function_lang_is('public', 'set_updated_at', array[]::text[], 'plpgsql', 'set_updated_at() is written in plpgsql');
select function_returns('public', 'set_updated_at', array[]::text[], 'trigger', 'set_updated_at() returns trigger');
select volatility_is('public', 'set_updated_at', array[]::text[], 'volatile', 'set_updated_at() is VOLATILE (default, not declared otherwise)');

-- public.current_company_id() — plpgsql (fixed post-PR4, see migration
-- comment), stable, security definer (design.md D-2)
select has_function('public', 'current_company_id', array[]::text[], 'public.current_company_id() exists');
select function_lang_is('public', 'current_company_id', array[]::text[], 'plpgsql', 'current_company_id() is written in plpgsql (language sql would fail CREATE FUNCTION against a nonexistent profiles table)');
select function_returns('public', 'current_company_id', array[]::text[], 'uuid', 'current_company_id() returns uuid');
select is_definer('public', 'current_company_id', array[]::text[], 'current_company_id() is SECURITY DEFINER');
select volatility_is('public', 'current_company_id', array[]::text[], 'stable', 'current_company_id() is STABLE');

select * from finish();

rollback;
