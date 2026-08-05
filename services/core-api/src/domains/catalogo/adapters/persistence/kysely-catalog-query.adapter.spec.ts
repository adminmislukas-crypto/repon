import type { Kysely } from 'kysely';
import type { RefillItem } from '@repon/types';
import type { DB } from '../../../../shared/database/schema';
import {
  CatalogQueryUnavailableError,
  MAX_COINCIDENCIAS_POR_ITEM,
} from '../../contracts/catalog-query.port';
import { KyselyCatalogQueryAdapter } from './kysely-catalog-query.adapter';

// core-api-catalogo spec, "CatalogQueryPort fails closed on infrastructure
// failure — never a silent empty result" (both scenarios) + "Cross-tenant
// matching reads exclude a suspended company's catalog" (design.md D-B/C7).

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
  const eb = Object.assign(
    jest.fn((...args: unknown[]) => {
      record('eb()', args);
      return { __cond: args };
    }),
    {
      or: jest.fn((arr: unknown[]) => {
        record('or', [arr]);
        return { __or: arr };
      }),
      and: jest.fn((arr: unknown[]) => {
        record('and', [arr]);
        return { __and: arr };
      }),
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
    },
  );
  return { eb, ebCalls };
}

function buildDb(execImpl: () => Promise<unknown[]>) {
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
  chain.limit = jest.fn(() => chain);
  chain.execute = jest.fn(execImpl);
  const selectFrom = jest.fn(() => chain);
  const db = { selectFrom } as unknown as Kysely<DB>;
  return { db, selectFrom, chain, ebCalls, whereCalls };
}

function buildItem(overrides: Partial<RefillItem> = {}): RefillItem {
  return {
    id: 'refill-item-1',
    nombre: 'Agua',
    categoria: 'Bebidas',
    precioReferencia: 100,
    ...overrides,
  };
}

describe('KyselyCatalogQueryAdapter', () => {
  it('resolves to [] without querying when itemsSolicitados is empty (C6 short-circuit)', async () => {
    const { db, selectFrom } = buildDb(async () => []);
    const adapter = new KyselyCatalogQueryAdapter(db);

    await expect(adapter.buscarCoincidencias([])).resolves.toEqual([]);
    expect(selectFrom).not.toHaveBeenCalled();
  });

  it('applies the visibility anti-join against catalog_hidden_companies (C4/D-A)', async () => {
    const { db, ebCalls } = buildDb(async () => []);
    const adapter = new KyselyCatalogQueryAdapter(db);

    await adapter.buscarCoincidencias([buildItem()]);

    expect(ebCalls['selectFrom']).toEqual([['catalog_hidden_companies as h']]);
    expect(ebCalls['sub.whereRef']).toEqual([['h.company_id', '=', 'pc.company_id']]);
    expect(ebCalls['sub.where']).toEqual([['h.oculto', '=', true]]);
  });

  it('filters disponible = true (C5)', async () => {
    const { db, whereCalls } = buildDb(async () => []);
    const adapter = new KyselyCatalogQueryAdapter(db);

    await adapter.buscarCoincidencias([buildItem()]);

    expect(whereCalls).toContainEqual(['pc.disponible', '=', true]);
  });

  it('caps the query with a defensive LIMIT scaled by MAX_COINCIDENCIAS_POR_ITEM * item count (C7)', async () => {
    const { db, chain } = buildDb(async () => []);
    const adapter = new KyselyCatalogQueryAdapter(db);
    const items = [buildItem({ id: 'i1' }), buildItem({ id: 'i2', nombre: 'Detergente' })];

    await adapter.buscarCoincidencias(items);

    expect(chain.limit).toHaveBeenCalledWith(MAX_COINCIDENCIAS_POR_ITEM * 2);
  });

  it('scopes to a single company when companyId is provided', async () => {
    const { db, whereCalls } = buildDb(async () => []);
    const adapter = new KyselyCatalogQueryAdapter(db);

    await adapter.buscarCoincidencias([buildItem()], 'company-a');

    expect(whereCalls).toContainEqual(['pc.company_id', '=', 'company-a']);
  });

  it('does NOT scope to a company when companyId is omitted', async () => {
    const { db, whereCalls } = buildDb(async () => []);
    const adapter = new KyselyCatalogQueryAdapter(db);

    await adapter.buscarCoincidencias([buildItem()]);

    expect(whereCalls.some((call) => call[0] === 'pc.company_id')).toBe(false);
  });

  it('maps precio_base/precio_maximo string rows to number (D-C gotcha)', async () => {
    const row = {
      id: 'item-1',
      company_id: 'company-a',
      catalog_product_id: null,
      nombre: 'Agua',
      categoria: 'Bebidas',
      precio_base: '1000.00',
      precio_maximo: '1500.00',
      stock: 10,
      disponible: true,
      imagen_url: null,
      created_at: '2026-01-01T00:00:00Z',
      updated_at: '2026-01-01T00:00:00Z',
    };
    const { db } = buildDb(async () => [row]);
    const adapter = new KyselyCatalogQueryAdapter(db);

    const result = await adapter.buscarCoincidencias([buildItem()]);

    expect(result).toEqual([
      {
        id: 'item-1',
        companyId: 'company-a',
        catalogProductId: undefined,
        nombre: 'Agua',
        categoria: 'Bebidas',
        precioBase: 1000,
        precioMaximo: 1500,
        stock: 10,
        disponible: true,
        imagenUrl: undefined,
      },
    ]);
  });

  // core-api-catalogo Scenario "A genuine zero-match result is
  // distinguishable from a failure".
  it('resolves to [] on a genuine zero-match result — never conflated with a failure', async () => {
    const { db } = buildDb(async () => []);
    const adapter = new KyselyCatalogQueryAdapter(db);

    await expect(adapter.buscarCoincidencias([buildItem()])).resolves.toEqual([]);
  });

  // core-api-catalogo Scenario "A database failure surfaces as an explicit
  // error, not an empty match list".
  it('wraps any Kysely/pg failure as CatalogQueryUnavailableError, preserving cause (C8/D-B)', async () => {
    const dbError = new Error('connection terminated unexpectedly');
    const { db } = buildDb(async () => {
      throw dbError;
    });
    const adapter = new KyselyCatalogQueryAdapter(db);

    await expect(adapter.buscarCoincidencias([buildItem()])).rejects.toThrow(
      CatalogQueryUnavailableError,
    );
    await expect(adapter.buscarCoincidencias([buildItem()])).rejects.toMatchObject({
      cause: dbError,
    });
  });
});
