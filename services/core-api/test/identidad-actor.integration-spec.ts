import type { Pool } from 'pg';
import { Kysely, PostgresDialect } from 'kysely';
import { createDatabasePool } from '../src/shared/database/pool.provider';
import { IdentidadActorAdapter } from '../src/domains/identidad/contracts/identidad-actor.adapter';
import type { DB } from '../src/shared/database/schema';

// Opt-in, excluded from CI (same pattern as database.integration-spec.ts,
// task 3.2) — requires a local `supabase start`. First proof the auth
// chain's DB half works end-to-end: a real `profiles ⋈ admin_roles ⋈
// companies` row resolves via `IdentidadActorAdapter` under
// `service_role`'s grants (D-A) — the `.spec.ts` sibling only mocks Kysely.
const SEEDED_ADMIN_PROFILE_ID = '00000000-0000-0000-0000-000000000001'; // supabase/seed.sql

describe('IdentidadActorAdapter (integration)', () => {
  let pool: Pool;
  let db: Kysely<DB>;
  let adapter: IdentidadActorAdapter;

  beforeAll(() => {
    const connectionString =
      process.env.DATABASE_URL ?? 'postgresql://authenticator:postgres@127.0.0.1:54322/postgres';
    pool = createDatabasePool(connectionString);
    db = new Kysely<DB>({ dialect: new PostgresDialect({ pool }) });
    adapter = new IdentidadActorAdapter(db);
  });

  afterAll(async () => {
    await db.destroy();
  });

  it('resolves the seeded super_admin with one JOIN query', async () => {
    const actor = await adapter.findActorById(SEEDED_ADMIN_PROFILE_ID);

    expect(actor).toEqual({
      profileId: SEEDED_ADMIN_PROFILE_ID,
      role: 'admin',
      status: 'activo',
      companyId: null,
      companyStatus: null,
      adminRole: 'super_admin',
    });
  });

  it('returns null for a profile id with no matching row', async () => {
    const actor = await adapter.findActorById('99999999-9999-9999-9999-999999999999');
    expect(actor).toBeNull();
  });
});
