import type { Pool } from 'pg';
import { Kysely, PostgresDialect } from 'kysely';
import { createDatabasePool } from '../src/shared/database/pool.provider';
import { KyselyConsumptionRepository } from '../src/domains/consumo/adapters/persistence/kysely-consumption.repository';
import type { DB } from '../src/shared/database/schema';

// Opt-in, excluded from CI — same established pattern as
// `database.integration-spec.ts` / `identidad-actor.integration-spec.ts` /
// `catalogo-provider-catalog-upsert.integration-spec.ts` /
// `consumo-descontar-stock.integration-spec.ts`: a `*.integration-spec.ts`
// file, picked up ONLY by `test/jest-integration.json`
// (`testRegex: "\\.integration-spec\\.ts$"`), run explicitly via
// `pnpm --filter core-api test:integration` — never by the default
// `pnpm test`. Requires a local `supabase start`.
//
// Proves design.md D-A/D-E's central claim: `intentarMarcarStockBajo`'s
// `UPDATE ... WHERE stock_bajo_notificado_at IS NULL RETURNING id` is a
// single statement Postgres serializes via its own row-lock, so TWO
// concurrent callers racing the SAME row can never both "win" the claim —
// this is what makes the cron safe across N replicas / overlapping runs
// with ZERO application-level locking (D-E: "no hace falta un advisory
// lock"). A mocked-Kysely unit test (see the `.spec.ts` sibling) cannot
// exercise this: the guarantee lives in Postgres's own row-lock, not in any
// TypeScript this repository controls.
const SEEDED_ADMIN_PROFILE_ID = '00000000-0000-0000-0000-000000000001'; // supabase/seed.sql — reused as the profiles(id) FK target; no dedicated 'user'-role profile is seeded.

async function insertConsumption(db: Kysely<DB>): Promise<string> {
  const row = await db
    .insertInto('user_consumption')
    .values({
      user_id: SEEDED_ADMIN_PROFILE_ID,
      owner_type: 'self',
      kind: 'medicamento',
      nombre: 'CAS Race Integration Test Item',
      unidad: 'mg',
      dosis_por_toma: '1.00',
      frecuencia_dias: 1,
      horarios: ['08:00'],
      stock_actual: '1.00',
      auto_crear_refill: false,
    })
    .returning('id')
    .executeTakeFirstOrThrow();
  return row.id;
}

describe('KyselyConsumptionRepository.intentarMarcarStockBajo — concurrent CAS race (integration, design.md D-A/D-E)', () => {
  let pool: Pool;
  let db: Kysely<DB>;
  let repo: KyselyConsumptionRepository;

  beforeAll(() => {
    const connectionString =
      process.env.DATABASE_URL ?? 'postgresql://authenticator:postgres@127.0.0.1:54322/postgres';
    pool = createDatabasePool(connectionString);
    db = new Kysely<DB>({ dialect: new PostgresDialect({ pool }) });
    repo = new KyselyConsumptionRepository(db);
  });

  afterAll(async () => {
    await db.destroy();
  });

  it('exactly one of two concurrent claims on the same row wins — the other loses, never both', async () => {
    const id = await insertConsumption(db);
    const now = new Date();

    const [first, second] = await Promise.all([
      repo.intentarMarcarStockBajo(id, now),
      repo.intentarMarcarStockBajo(id, now),
    ]);

    // Exactly one `true`, exactly one `false` — never both true (would mean
    // two events published for the same episode, D5/D-E's duplicate-alert
    // failure mode this CAS exists to prevent) and never both false (would
    // mean the alert is silently lost even though nobody had claimed it).
    expect([first, second].filter((won) => won === true)).toHaveLength(1);
    expect([first, second].filter((won) => won === false)).toHaveLength(1);

    const row = await db
      .selectFrom('user_consumption')
      .select('stock_bajo_notificado_at')
      .where('id', '=', id)
      .executeTakeFirstOrThrow();
    expect(row.stock_bajo_notificado_at).not.toBeNull();
  });

  it('a third claim after the row is already marked always loses, sequentially', async () => {
    const id = await insertConsumption(db);
    const now = new Date();

    const firstClaim = await repo.intentarMarcarStockBajo(id, now);
    const secondClaim = await repo.intentarMarcarStockBajo(id, now);

    expect(firstClaim).toBe(true);
    expect(secondClaim).toBe(false);
  });
});
