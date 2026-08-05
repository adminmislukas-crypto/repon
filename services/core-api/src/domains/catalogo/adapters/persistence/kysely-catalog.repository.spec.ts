import type { Kysely, Selectable } from 'kysely';
import type { DB, ProviderCatalogTable } from '../../../../shared/database/schema';
import { KyselyCatalogRepository } from './kysely-catalog.repository';

// core-api-catalogo spec, "Cross-tenant matching reads exclude a suspended
// company's catalog; the owner's own read does not" — the crux of design.md
// D-A's correction. `findMatching` is the cross-tenant marketplace surface
// and MUST apply the `catalog_hidden_companies` anti-join; `findByCompany`/
// `findByCompanyAndCategoria` are the owner's own reads and MUST NOT.
//
// Mocked Kysely query-builder chain (same convention as
// `identidad-actor.adapter.spec.ts` / `kysely-audit-log.adapter.spec.ts`):
// `.where(callback)` is invoked with a fake `eb` that records whether the
// anti-join's `eb.selectFrom('catalog_hidden_companies as h')` subquery was
// ever built — that single call is the observable signature of "the
// predicate is present", independent of the real SQL text.

interface FakeSubBuilder {
  select: jest.Mock<FakeSubBuilder, unknown[]>;
  whereRef: jest.Mock<FakeSubBuilder, unknown[]>;
  where: jest.Mock<FakeSubBuilder, unknown[]>;
}

function makeFakeEb() {
  const ebCalls: Record<string, unknown[][]> = {};
  const record = (method: string, args: unknown[]) => {
    (ebCalls[method] ??= []).push(args);
  };
  const subBuilder: FakeSubBuilder = {
    select: jest.fn(() => subBuilder),
    whereRef: jest.fn((...args: unknown[]) => {
      record('sub.whereRef', args);
      return subBuilder;
    }),
    where: jest.fn((...args: unknown[]) => {
      record('sub.where', args);
      return subBuilder;
    }),
  };
  const eb = {
    not: jest.fn((inner: unknown) => {
      record('not', [inner]);
      return { __not: inner };
    }),
    exists: jest.fn((sub: unknown) => {
      record('exists', [sub]);
      return { __exists: sub };
    }),
    selectFrom: jest.fn((table: string) => {
      record('selectFrom', [table]);
      return subBuilder;
    }),
  };
  return { eb, ebCalls };
}

function buildDb(rows: unknown[]) {
  const { eb, ebCalls } = makeFakeEb();
  const whereCalls: unknown[][] = [];
  const chain: Record<string, jest.Mock> = {};
  chain.selectAll = jest.fn(() => chain);
  chain.where = jest.fn((...args: unknown[]) => {
    if (typeof args[0] === 'function') {
      (args[0] as (eb: unknown) => unknown)(eb);
    } else {
      whereCalls.push(args);
    }
    return chain;
  });
  chain.execute = jest.fn(async () => rows);
  chain.executeTakeFirst = jest.fn(async () => rows[0]);
  const selectFrom = jest.fn(() => chain);
  const db = { selectFrom } as unknown as Kysely<DB>;
  return { db, selectFrom, chain, ebCalls, whereCalls };
}

function buildRow(
  overrides: Partial<Selectable<ProviderCatalogTable>> = {},
): Selectable<ProviderCatalogTable> {
  return {
    id: 'item-1',
    company_id: 'company-a',
    catalog_product_id: null,
    nombre: 'Agua Purificada',
    categoria: 'Bebidas',
    // node-postgres returns `numeric` as `string` (D-C's gotcha).
    precio_base: '1000.00',
    precio_maximo: '1500.00',
    stock: 10,
    disponible: true,
    imagen_url: null,
    created_at: '2026-01-01T00:00:00Z',
    updated_at: '2026-01-01T00:00:00Z',
    ...overrides,
  };
}

describe('KyselyCatalogRepository', () => {
  describe('findById', () => {
    it('maps a found row, converting precio_base/precio_maximo string -> number (D-C gotcha)', async () => {
      const { db } = buildDb([buildRow()]);
      const repo = new KyselyCatalogRepository(db);

      const result = await repo.findById('item-1');

      expect(result).toEqual({
        id: 'item-1',
        companyId: 'company-a',
        catalogProductId: undefined,
        nombre: 'Agua Purificada',
        categoria: 'Bebidas',
        precioBase: 1000,
        precioMaximo: 1500,
        stock: 10,
        disponible: true,
        imagenUrl: undefined,
      });
    });

    it('returns null when no row matches', async () => {
      const { db } = buildDb([]);
      const repo = new KyselyCatalogRepository(db);

      await expect(repo.findById('missing')).resolves.toBeNull();
    });
  });

  describe('findByCompany — the owner reading their own catalog', () => {
    it('does NOT apply the visibility anti-join (core-api-catalogo "own provider still reads own catalog")', async () => {
      const { db, ebCalls, whereCalls } = buildDb([buildRow()]);
      const repo = new KyselyCatalogRepository(db);

      await repo.findByCompany('company-a');

      expect(ebCalls['selectFrom']).toBeUndefined();
      expect(whereCalls).toEqual([['company_id', '=', 'company-a']]);
    });
  });

  describe('findByCompanyAndCategoria — also an owner-scoped read', () => {
    it('does NOT apply the visibility anti-join either', async () => {
      const { db, ebCalls, whereCalls } = buildDb([buildRow()]);
      const repo = new KyselyCatalogRepository(db);

      await repo.findByCompanyAndCategoria('company-a', 'Bebidas');

      expect(ebCalls['selectFrom']).toBeUndefined();
      expect(whereCalls).toEqual([
        ['company_id', '=', 'company-a'],
        ['categoria', '=', 'Bebidas'],
      ]);
    });
  });

  describe('findMatching — the cross-tenant marketplace surface', () => {
    it('DOES apply the visibility anti-join against catalog_hidden_companies (design.md D-A)', async () => {
      const { db, ebCalls } = buildDb([buildRow()]);
      const repo = new KyselyCatalogRepository(db);

      await repo.findMatching('Bebidas', 'Agua');

      expect(ebCalls['selectFrom']).toEqual([['catalog_hidden_companies as h']]);
      expect(ebCalls['sub.whereRef']).toEqual([['h.company_id', '=', 'pc.company_id']]);
      expect(ebCalls['sub.where']).toEqual([['h.oculto', '=', true]]);
      expect(ebCalls['exists']).toHaveLength(1);
      expect(ebCalls['not']).toHaveLength(1);
    });

    it('filters by exact categoria and fuzzy nombre', async () => {
      const { db, whereCalls } = buildDb([buildRow()]);
      const repo = new KyselyCatalogRepository(db);

      await repo.findMatching('Bebidas', 'Agua');

      expect(whereCalls).toContainEqual(['pc.categoria', '=', 'Bebidas']);
      expect(whereCalls).toContainEqual(['pc.nombre', 'ilike', '%Agua%']);
    });

    it('is a provable no-op today: catalog_hidden_companies is still empty (PR 8a has not landed), so the SAME fixtures that pass findByCompany also pass findMatching unfiltered-in-effect', async () => {
      // The anti-join predicate is built and sent on every findMatching
      // call (asserted above) — but with zero rows in the projection table,
      // `NOT EXISTS` is trivially true for every row, so today's observable
      // result set is identical to a query without the predicate. This test
      // exercises the exact same `buildRow()` fixture used by
      // `findByCompany`'s test to make that equivalence explicit.
      const { db } = buildDb([buildRow()]);
      const repo = new KyselyCatalogRepository(db);

      const result = await repo.findMatching('Bebidas', 'Agua');

      expect(result).toEqual([
        {
          id: 'item-1',
          companyId: 'company-a',
          catalogProductId: undefined,
          nombre: 'Agua Purificada',
          categoria: 'Bebidas',
          precioBase: 1000,
          precioMaximo: 1500,
          stock: 10,
          disponible: true,
          imagenUrl: undefined,
        },
      ]);
    });
  });

  describe('save / saveMany — not yet implemented (PR 4a / PR 6)', () => {
    it('save throws, naming PR 4a, rather than silently no-oping', async () => {
      const { db } = buildDb([]);
      const repo = new KyselyCatalogRepository(db);

      await expect(
        repo.save({
          id: 'item-1',
          companyId: 'company-a',
          nombre: 'Agua',
          categoria: 'Bebidas',
          precioBase: 100,
          precioMaximo: 150,
          stock: 5,
          disponible: true,
        }),
      ).rejects.toThrow(/PR 4a/);
    });

    it('saveMany throws, naming PR 6, rather than silently no-oping', async () => {
      const { db } = buildDb([]);
      const repo = new KyselyCatalogRepository(db);

      await expect(repo.saveMany([])).rejects.toThrow(/PR 6/);
    });
  });
});
