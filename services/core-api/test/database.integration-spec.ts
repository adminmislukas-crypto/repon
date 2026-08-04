import { Client, type Pool } from 'pg';
import { Kysely, PostgresDialect, sql } from 'kysely';
import { createDatabasePool } from '../src/shared/database/pool.provider';
import { KyselyTransactionManager } from '../src/shared/database/transaction';
import { KyselyAuditLogAdapter } from '../src/shared/audit/kysely-audit-log.adapter';
import type { DB } from '../src/shared/database/schema';

// Opt-in, excluded from CI (design.md's testing strategy table + tasks.md
// task 3.2): requires a real local Supabase/Postgres instance running
// (`supabase start`, DB on 54322). Run explicitly:
//   pnpm --filter core-api test:integration
//
// This file is the single acceptance criterion PR 4 exists to prove
// (design.md D-A risk #1): the role `DATABASE_URL` resolves to MUST carry
// `service_role`'s grants — not the `postgres` table-owner's — because
// `audit_log`'s (and later `order_items`'s) append-only guarantee is
// enforced by `REVOKE UPDATE, DELETE ... FROM service_role`, which a
// table-owner connection silently bypasses. See
// `src/shared/database/pool.provider.ts` for the closed decision
// (`authenticator` + `SET ROLE service_role`) and `.env.example` for how a
// hosted project's `DATABASE_URL` differs.
const SEEDED_ADMIN_PROFILE_ID = '00000000-0000-0000-0000-000000000001'; // supabase/seed.sql

async function assertSeedIsPresent(): Promise<void> {
  // Test-fixture readiness check ONLY — deliberately connects as the
  // `postgres` superuser (never `core-api`'s own DATABASE_URL role) purely
  // to give a clear, actionable failure instead of a cryptic FK-violation
  // if `supabase db reset` was never run locally. No application code ever
  // connects this way.
  const client = new Client({
    connectionString:
      process.env.TEST_SUPERUSER_DATABASE_URL ??
      'postgresql://postgres:postgres@127.0.0.1:54322/postgres',
  });
  await client.connect();
  try {
    const result = await client.query('select 1 from public.profiles where id = $1', [
      SEEDED_ADMIN_PROFILE_ID,
    ]);
    if (result.rowCount === 0) {
      throw new Error(
        `Seeded admin profile ${SEEDED_ADMIN_PROFILE_ID} not found. Run \`supabase db reset\` ` +
          'to apply supabase/seed.sql before running the integration suite.',
      );
    }
  } finally {
    await client.end();
  }
}

describe('Database kernel — service_role connection & audit_log grants (integration)', () => {
  let pool: Pool;
  let db: Kysely<DB>;
  let transactionManager: KyselyTransactionManager;
  let auditLog: KyselyAuditLogAdapter;

  beforeAll(async () => {
    await assertSeedIsPresent();

    const connectionString =
      process.env.DATABASE_URL ?? 'postgresql://authenticator:postgres@127.0.0.1:54322/postgres';
    pool = createDatabasePool(connectionString);
    db = new Kysely<DB>({ dialect: new PostgresDialect({ pool }) });
    transactionManager = new KyselyTransactionManager(db);
    auditLog = new KyselyAuditLogAdapter(db);
  });

  afterEach(async () => {
    // `service_role` carries TRUNCATE (Supabase's own baseline default ACL
    // — verified against the local stack, unrelated to this change's own
    // grants) even though it has neither UPDATE nor DELETE on this table.
    // Test-only cleanup; application code never truncates audit_log.
    await sql`truncate table public.audit_log`.execute(db);
  });

  afterAll(async () => {
    await db.destroy();
  });

  it('authenticates under service_role, never the postgres table-owner', async () => {
    const result = await sql<{
      current_user: string;
      session_user: string;
    }>`select current_user, session_user`.execute(db);

    expect(result.rows[0]?.current_user).toBe('service_role');
    // `session_user` stays the login role (`authenticator` locally) — `SET
    // ROLE` changes privilege evaluation, not the authenticated identity.
    // `service_role` itself has `rolcanlogin = false` (verified against
    // the local stack), so logging in AS `service_role` directly isn't
    // possible in the first place; asserting both columns distinguishes
    // "we switched role after connecting" from a same-named coincidence.
    expect(result.rows[0]?.session_user).not.toBe('service_role');
  });

  it('inserts an audit_log row via KyselyAuditLogAdapter under service_role', async () => {
    await auditLog.record({
      actorProfileId: SEEDED_ADMIN_PROFILE_ID,
      accion: 'test_probe_insert',
      entityType: 'company',
      entityId: '00000000-0000-0000-0000-000000000099',
      cambios: { status: { antes: 'pendiente', despues: 'activo' } },
    });

    const rows = await db.selectFrom('audit_log').selectAll().execute();
    expect(rows).toHaveLength(1);
    expect(rows[0]?.accion).toBe('test_probe_insert');
    expect(rows[0]?.cambios).toEqual({ status: { antes: 'pendiente', despues: 'activo' } });
  });

  it('TransactionManager rolls back an audit_log insert when the work function throws', async () => {
    await expect(
      transactionManager.runInTransaction(async (tx) => {
        await auditLog.record(
          {
            actorProfileId: SEEDED_ADMIN_PROFILE_ID,
            accion: 'test_probe_rollback',
            entityType: 'company',
            entityId: '00000000-0000-0000-0000-000000000098',
            cambios: {},
          },
          tx,
        );
        throw new Error('force rollback');
      }),
    ).rejects.toThrow('force rollback');

    const rows = await db.selectFrom('audit_log').selectAll().execute();
    expect(rows).toHaveLength(0);
  });

  it('rejects UPDATE against audit_log — the append-only guarantee this PR exists to prove (design.md D-A risk #1)', async () => {
    await auditLog.record({
      actorProfileId: SEEDED_ADMIN_PROFILE_ID,
      accion: 'test_probe_immutable',
      entityType: 'company',
      entityId: '00000000-0000-0000-0000-000000000097',
      cambios: {},
    });

    await expect(
      db
        .updateTable('audit_log')
        .set({ accion: 'tampered' })
        .where('accion', '=', 'test_probe_immutable')
        .execute(),
    ).rejects.toThrow(/permission denied/i);
  });

  it('rejects DELETE against audit_log', async () => {
    await auditLog.record({
      actorProfileId: SEEDED_ADMIN_PROFILE_ID,
      accion: 'test_probe_immutable_delete',
      entityType: 'company',
      entityId: '00000000-0000-0000-0000-000000000096',
      cambios: {},
    });

    await expect(
      db.deleteFrom('audit_log').where('accion', '=', 'test_probe_immutable_delete').execute(),
    ).rejects.toThrow(/permission denied/i);
  });
});
