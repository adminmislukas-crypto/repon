import { randomUUID } from 'node:crypto';
import type { Pool } from 'pg';
import { Kysely, PostgresDialect, sql } from 'kysely';
import { createDatabasePool } from '../src/shared/database/pool.provider';
import type { DB } from '../src/shared/database/schema';

// Opt-in, excluded from CI (same pattern as database.integration-spec.ts /
// identidad-actor.integration-spec.ts, tasks.md task 1.7) — requires a
// local `supabase start`. Proves the two partial unique indexes from
// 20260805120000_11_catalogo_provider_catalog_upsert_index.sql (design.md
// D-C) actually make `ON CONFLICT` resolve to a single valid target on
// REAL Postgres for BOTH mutually-exclusive branches, and that `numeric`
// columns round-trip through node-postgres as `string` (D-C's gotcha) —
// properties no unit test (mocked Kysely) can verify. Run explicitly:
//   pnpm --filter core-api test:integration
//
// Each test creates its own company (and, for branch A, its own reference
// catalog product) with a fresh random identity, so tests are independent
// and safe to re-run without `supabase db reset` between runs — this
// schema grants `service_role` no DELETE (20260804090500_10_...sql), so
// tests do not attempt cleanup, matching the repo's own convention.

async function insertCompany(db: Kysely<DB>): Promise<string> {
  const row = await db
    .insertInto('companies')
    .values({
      razon_social: `Test Co ${randomUUID()}`,
      rut: randomUUID().slice(0, 12),
      giro: 'Test',
    })
    .returning('id')
    .executeTakeFirstOrThrow();
  return row.id;
}

async function insertCatalogProduct(db: Kysely<DB>): Promise<string> {
  const row = await db
    .insertInto('catalog_products')
    .values({ nombre: `Producto ${randomUUID()}`, categoria: 'Alimento' })
    .returning('id')
    .executeTakeFirstOrThrow();
  return row.id;
}

describe('provider_catalog upsert indexes (integration, design.md D-C)', () => {
  let pool: Pool;
  let db: Kysely<DB>;

  beforeAll(() => {
    const connectionString =
      process.env.DATABASE_URL ?? 'postgresql://authenticator:postgres@127.0.0.1:54322/postgres';
    pool = createDatabasePool(connectionString);
    db = new Kysely<DB>({ dialect: new PostgresDialect({ pool }) });
  });

  afterAll(async () => {
    await db.destroy();
  });

  it('branch A (catalogProductId present): re-upload upserts via ON CONFLICT (company_id, catalog_product_id) instead of duplicating', async () => {
    const companyId = await insertCompany(db);
    const catalogProductId = await insertCatalogProduct(db);

    const upsert = (precioBase: string, precioMaximo: string) =>
      sql`
      insert into provider_catalog
        (company_id, catalog_product_id, nombre, categoria, precio_base, precio_maximo, stock, disponible)
      values
        (${companyId}, ${catalogProductId}, 'Alimento Premium', 'Alimentos', ${precioBase}, ${precioMaximo}, 10, true)
      on conflict (company_id, catalog_product_id) where catalog_product_id is not null
      do update set precio_base = excluded.precio_base, precio_maximo = excluded.precio_maximo
    `.execute(db);

    await upsert('100.00', '200.00');
    await upsert('150.00', '250.00'); // re-upload, same identity, different price

    const rows = await db
      .selectFrom('provider_catalog')
      .selectAll()
      .where('company_id', '=', companyId)
      .where('catalog_product_id', '=', catalogProductId)
      .execute();

    expect(rows).toHaveLength(1);
    expect(rows[0]?.precio_base).toBe('150.00');
    // node-postgres returns `numeric` as `string`, never `number` (D-C's
    // gotcha) — the property that makes `precio_base: string` the correct
    // Kysely row type, not `number`.
    expect(typeof rows[0]?.precio_base).toBe('string');
  });

  it('branch B (catalogProductId absent): re-upload upserts via ON CONFLICT (company_id, lower(btrim(nombre)), lower(btrim(categoria))) instead of duplicating', async () => {
    const companyId = await insertCompany(db);

    const upsert = (nombre: string, categoria: string, precioBase: string, precioMaximo: string) =>
      sql`
      insert into provider_catalog
        (company_id, catalog_product_id, nombre, categoria, precio_base, precio_maximo, stock, disponible)
      values
        (${companyId}, null, ${nombre}, ${categoria}, ${precioBase}, ${precioMaximo}, 5, true)
      on conflict (company_id, lower(btrim(nombre)), lower(btrim(categoria))) where catalog_product_id is null
      do update set precio_base = excluded.precio_base, precio_maximo = excluded.precio_maximo
    `.execute(db);

    await upsert('Arena Sanitaria 5Kg', 'Higiene', '50.00', '90.00');
    // Same identity under lower(btrim(...)), different casing/whitespace —
    // exactly the noise a CSV re-upload produces (D-C).
    await upsert('  arena sanitaria 5kg ', ' higiene ', '60.00', '95.00');

    const rows = await db
      .selectFrom('provider_catalog')
      .selectAll()
      .where('company_id', '=', companyId)
      .where('catalog_product_id', 'is', null)
      .execute();

    expect(rows).toHaveLength(1);
    expect(rows[0]?.precio_base).toBe('60.00');
    // `KyselyCatalogRepository.save`'s full `DO UPDATE SET` column list
    // (including refreshing `nombre` verbatim, design.md D-C) is PR 4a's
    // scope, not this migration's — this test only proves the partial
    // index itself resolves both differently-cased inputs to one row.
  });

  it('the two partial indexes are mutually exclusive: a branch-A row and a branch-B row with the same (nombre, categoria) coexist without a 23505', async () => {
    const companyId = await insertCompany(db);
    const catalogProductId = await insertCatalogProduct(db);

    await sql`
      insert into provider_catalog
        (company_id, catalog_product_id, nombre, categoria, precio_base, precio_maximo, imagen_url)
      values (${companyId}, ${catalogProductId}, 'Mismo Nombre', 'Misma Categoria', 10.00, 20.00, null)
    `.execute(db);
    await sql`
      insert into provider_catalog
        (company_id, catalog_product_id, nombre, categoria, precio_base, precio_maximo, imagen_url)
      values (${companyId}, null, 'Mismo Nombre', 'Misma Categoria', 10.00, 20.00, null)
    `.execute(db);

    const rows = await db
      .selectFrom('provider_catalog')
      .selectAll()
      .where('company_id', '=', companyId)
      .execute();

    expect(rows).toHaveLength(2);
  });
});
