import type { Pool } from 'pg';
import { Kysely, PostgresDialect } from 'kysely';
import { createDatabasePool } from '../src/shared/database/pool.provider';
import { KyselyConsumptionRepository } from '../src/domains/consumo/adapters/persistence/kysely-consumption.repository';
import type { DB } from '../src/shared/database/schema';

// Opt-in, excluded from CI — same established pattern as
// `database.integration-spec.ts` / `identidad-actor.integration-spec.ts` /
// `catalogo-provider-catalog-upsert.integration-spec.ts`: a
// `*.integration-spec.ts` file, picked up ONLY by `test/jest-integration.json`
// (`testRegex: "\\.integration-spec\\.ts$"`), run explicitly via
// `pnpm --filter core-api test:integration` — never by the default
// `pnpm test` (root jest config's `rootDir` is `src/`, so `test/` isn't
// even scanned; `jest-e2e.json`'s `testRegex` requires the literal
// `e2e-spec.ts` suffix, which this filename doesn't have either). Requires
// a local `supabase start`.
//
// Proves `descontarStock`'s clamp-at-0 (design.md D-H.2: "UPDATE ... SET
// stock_actual = greatest(stock_actual - $2, 0) ... RETURNING stock_actual")
// against REAL Postgres `greatest()` — a property no unit test (mocked
// Kysely, see the `.spec.ts` sibling) can verify, since the entire point of
// D-H.2 is that the clamp lives in the SQL engine, not in this repository's
// TypeScript.
const SEEDED_ADMIN_PROFILE_ID = '00000000-0000-0000-0000-000000000001'; // supabase/seed.sql — reused as the profiles(id) FK target; no dedicated 'user'-role profile is seeded.

async function insertConsumption(
  db: Kysely<DB>,
  overrides: { dosis_por_toma: string; stock_actual: string },
): Promise<string> {
  const row = await db
    .insertInto('user_consumption')
    .values({
      user_id: SEEDED_ADMIN_PROFILE_ID,
      owner_type: 'self',
      kind: 'medicamento',
      nombre: 'Integration Test Item',
      unidad: 'mg',
      frecuencia_dias: 1,
      horarios: ['08:00'],
      auto_crear_refill: false,
      ...overrides,
    })
    .returning('id')
    .executeTakeFirstOrThrow();
  return row.id;
}

describe('KyselyConsumptionRepository.descontarStock (integration, design.md D-H.2)', () => {
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

  it('decrements normally when stock covers the dose', async () => {
    const id = await insertConsumption(db, { dosis_por_toma: '2.00', stock_actual: '10.00' });

    const result = await repo.descontarStock(id, 2);

    expect(result).toBe(8);
  });

  it('clamps to 0, never negative, when stockActual < dosisPorToma (real Postgres greatest())', async () => {
    const id = await insertConsumption(db, { dosis_por_toma: '5.00', stock_actual: '1.00' });

    const result = await repo.descontarStock(id, 5);

    expect(result).toBe(0);

    const row = await db
      .selectFrom('user_consumption')
      .select('stock_actual')
      .where('id', '=', id)
      .executeTakeFirstOrThrow();
    // node-postgres returns `numeric` as `string` (D-C's gotcha) — verified
    // here against a REAL row, not mocked. Genuine discovery this
    // integration test exists to catch: when `greatest(x, 0)`'s literal `0`
    // branch wins, Postgres returns a scale-0 numeric ('0'), NOT '0.00' —
    // the scale of the *losing* operand does not carry over. `Number('0')`
    // still correctly equals `0` either way (proven by the `result` assertion
    // above), so `descontarStock`'s return value is unaffected; only the raw
    // column's string representation differs from the non-clamped case.
    expect(row.stock_actual).toBe('0');
  });

  it('a second call after already clamping to 0 stays at 0 — never goes negative across repeated calls', async () => {
    const id = await insertConsumption(db, { dosis_por_toma: '3.00', stock_actual: '2.00' });

    const first = await repo.descontarStock(id, 3);
    const second = await repo.descontarStock(id, 3);

    expect(first).toBe(0);
    expect(second).toBe(0);
  });
});
