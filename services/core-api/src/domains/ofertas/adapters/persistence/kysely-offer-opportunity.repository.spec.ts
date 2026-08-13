import type { Kysely } from 'kysely';
import type { DB, RefillUrgenciaRow } from '../../../../shared/database/schema';
import type { TransactionContext } from '../../../../shared/database/transaction';
import type {
  OportunidadSnapshot,
  OportunidadSnapshotItem,
} from '../../ports-out/offer-opportunity-repository.port';
import { KyselyOfferOpportunityRepository } from './kysely-offer-opportunity.repository';

// design.md D-A.2 — the writer's exact 5-statement shape (tasks.md 3b.1/3b.2,
// D18-4, "the single most important test in this file"):
//   1. upsert cabecera            (cerrada_at NEVER in the SET — D-A.3)
//   2. UPDATE companies vigente=false   -- retire, ALWAYS before (3)
//   3. upsert companies vigente=true    -- OMITTED when companyIds: []
//   4. UPDATE items vigente=false       -- retire, ALWAYS before (5)
//   5. upsert items vigente=true
//
// This mocked query-builder harness is the FIRST in this repo to cover a
// BULK multi-row `ON CONFLICT ... DO UPDATE SET` (every prior upsert in the
// codebase — `KyselyCompanyRepository.save`, `KyselyPetRepository.save`,
// `KyselyCatalogVisibilityProjection.ocultarEmpresa` — is single-row, so a
// static JS-literal `doUpdateSet({...})` is correct there: the one row being
// inserted IS the one row being updated, so the literal happens to equal
// `excluded.x`). Statement 5 (items) is NOT single-row — a bulk insert of N
// items conflicting on N different `refill_item_id`s needs `doUpdateSet`'s
// CALLBACK form (`(eb) => ({ col: eb.ref('excluded.col') })`) so each
// conflicting row is set from ITS OWN excluded row, not from one shared JS
// literal. This harness distinguishes the two `doUpdateSet` call shapes
// explicitly (`resolveDoUpdateSet` below) so a regression to the wrong shape
// on statement 5 fails loudly instead of silently corrupting every item but
// the last one inserted.

function excludedRef(column: string): { __excludedRef: string } {
  return { __excludedRef: column };
}

const EB_STUB = { ref: jest.fn((column: string) => excludedRef(column)) };

/** Resolves whichever shape `doUpdateSet` was actually invoked with, so
 *  assertions can inspect the resulting SET object regardless of whether the
 *  adapter used a static literal or the `(eb) => ({...})` callback form. */
function resolveDoUpdateSet(arg: unknown): Record<string, unknown> {
  return typeof arg === 'function'
    ? (arg as (eb: typeof EB_STUB) => Record<string, unknown>)(EB_STUB)
    : (arg as Record<string, unknown>);
}

function makeOnConflictBuilder(prefix: string, calls: Record<string, unknown[][]>) {
  const record = (method: string, args: unknown[]) => {
    (calls[`${prefix}.onConflict.${method}`] ??= []).push(args);
  };
  const builder: Record<string, jest.Mock> = {};
  builder.column = jest.fn((...args: unknown[]) => {
    record('column', args);
    return builder;
  });
  builder.columns = jest.fn((...args: unknown[]) => {
    record('columns', args);
    return builder;
  });
  builder.doUpdateSet = jest.fn((update: unknown) => {
    record('doUpdateSet', [resolveDoUpdateSet(update)]);
    // Remember whether this call used the callback form, for tests that
    // must distinguish "constant literal" from "per-row excluded ref".
    (calls[`${prefix}.onConflict.doUpdateSet.wasCallback`] ??= []).push([
      typeof update === 'function',
    ]);
    return builder;
  });
  return builder;
}

function buildReemplazarDb() {
  const order: string[] = [];
  const calls: Record<string, unknown[][]> = {};
  const record = (method: string, args: unknown[]) => {
    (calls[method] ??= []).push(args);
  };

  // --- 1. header upsert: insertInto('offer_opportunities') ---
  const headerOnConflict = makeOnConflictBuilder('header', calls);
  const headerChain: Record<string, jest.Mock> = {};
  headerChain.values = jest.fn((...args: unknown[]) => {
    record('header.values', args);
    return headerChain;
  });
  headerChain.onConflict = jest.fn((build: (oc: typeof headerOnConflict) => unknown) => {
    build(headerOnConflict);
    return headerChain;
  });
  headerChain.execute = jest.fn(async () => {
    order.push('1:upsert-cabecera');
  });

  // --- 2. retire companies: updateTable('offer_opportunity_companies') ---
  const retireCompaniesChain: Record<string, jest.Mock> = {};
  retireCompaniesChain.set = jest.fn((...args: unknown[]) => {
    record('retireCompanies.set', args);
    return retireCompaniesChain;
  });
  retireCompaniesChain.where = jest.fn((...args: unknown[]) => {
    record('retireCompanies.where', args);
    return retireCompaniesChain;
  });
  retireCompaniesChain.execute = jest.fn(async () => {
    order.push('2:retire-companies');
  });

  // --- 3. upsert companies: insertInto('offer_opportunity_companies') ---
  const companiesOnConflict = makeOnConflictBuilder('companies', calls);
  const upsertCompaniesChain: Record<string, jest.Mock> = {};
  upsertCompaniesChain.values = jest.fn((...args: unknown[]) => {
    record('upsertCompanies.values', args);
    return upsertCompaniesChain;
  });
  upsertCompaniesChain.onConflict = jest.fn(
    (build: (oc: typeof companiesOnConflict) => unknown) => {
      build(companiesOnConflict);
      return upsertCompaniesChain;
    },
  );
  upsertCompaniesChain.execute = jest.fn(async () => {
    order.push('3:upsert-companies');
  });

  // --- 4. retire items: updateTable('offer_opportunity_items') ---
  const retireItemsChain: Record<string, jest.Mock> = {};
  retireItemsChain.set = jest.fn((...args: unknown[]) => {
    record('retireItems.set', args);
    return retireItemsChain;
  });
  retireItemsChain.where = jest.fn((...args: unknown[]) => {
    record('retireItems.where', args);
    return retireItemsChain;
  });
  retireItemsChain.execute = jest.fn(async () => {
    order.push('4:retire-items');
  });

  // --- 5. upsert items: insertInto('offer_opportunity_items') ---
  const itemsOnConflict = makeOnConflictBuilder('items', calls);
  const upsertItemsChain: Record<string, jest.Mock> = {};
  upsertItemsChain.values = jest.fn((...args: unknown[]) => {
    record('upsertItems.values', args);
    return upsertItemsChain;
  });
  upsertItemsChain.onConflict = jest.fn((build: (oc: typeof itemsOnConflict) => unknown) => {
    build(itemsOnConflict);
    return upsertItemsChain;
  });
  upsertItemsChain.execute = jest.fn(async () => {
    order.push('5:upsert-items');
  });

  const insertInto = jest.fn((table: string) => {
    record('insertInto', [table]);
    if (table === 'offer_opportunities') return headerChain;
    if (table === 'offer_opportunity_companies') return upsertCompaniesChain;
    if (table === 'offer_opportunity_items') return upsertItemsChain;
    throw new Error(`unexpected insertInto table: ${table}`);
  });

  const updateTable = jest.fn((table: string) => {
    record('updateTable', [table]);
    if (table === 'offer_opportunity_companies') return retireCompaniesChain;
    if (table === 'offer_opportunity_items') return retireItemsChain;
    throw new Error(`unexpected updateTable table: ${table}`);
  });

  const db = { insertInto, updateTable } as unknown as Kysely<DB>;
  return {
    db,
    calls,
    order,
    headerChain,
    retireCompaniesChain,
    upsertCompaniesChain,
    retireItemsChain,
    upsertItemsChain,
    insertInto,
    updateTable,
  };
}

function snapshotItem(overrides: Partial<OportunidadSnapshotItem> = {}): OportunidadSnapshotItem {
  return {
    refillItemId: 'refill-item-1',
    nombre: 'Royal Canin 15kg',
    categoria: 'alimento',
    precioReferencia: 45990,
    catalogProductId: 'catalog-product-1',
    ...overrides,
  };
}

function buildSnapshot(overrides: Partial<OportunidadSnapshot> = {}): OportunidadSnapshot {
  return {
    refillRequestId: 'request-1',
    userId: 'user-1',
    comuna: 'Providencia',
    urgencia: 'hoy',
    companyIds: ['company-a', 'company-b'],
    items: [snapshotItem()],
    ...overrides,
  };
}

// UNUSED_DB: `reemplazar`/`cerrar` take `tx: TransactionContext` REQUIRED
// (design.md D-G.5) — the constructor's own `db` is never touched by either
// method, mirroring `KyselyOfferRepository`'s own `UNUSED_DB` convention for
// its required-tx methods (tasks.md 3a.7-3a.10's spec file).
const UNUSED_DB = {} as unknown as Kysely<DB>;

describe('KyselyOfferOpportunityRepository', () => {
  describe('reemplazar — the 5-statement writer, retire-before-upsert (tasks.md 3b.1/3b.2, D18-4, D-A.2)', () => {
    it('issues the 5 statements in the EXACT order: cabecera -> retire companies -> upsert companies -> retire items -> upsert items', async () => {
      const { db, order } = buildReemplazarDb();
      const repo = new KyselyOfferOpportunityRepository(UNUSED_DB);
      const tx = db as unknown as TransactionContext;

      await repo.reemplazar(buildSnapshot(), tx);

      expect(order).toEqual([
        '1:upsert-cabecera',
        '2:retire-companies',
        '3:upsert-companies',
        '4:retire-items',
        '5:upsert-items',
      ]);
    });

    it('reversed order (upsert-before-retire) would be wrong: retire ALWAYS precedes its own upsert, individually', async () => {
      const { db, order } = buildReemplazarDb();
      const repo = new KyselyOfferOpportunityRepository(UNUSED_DB);
      const tx = db as unknown as TransactionContext;

      await repo.reemplazar(buildSnapshot(), tx);

      const retireCompaniesIdx = order.indexOf('2:retire-companies');
      const upsertCompaniesIdx = order.indexOf('3:upsert-companies');
      const retireItemsIdx = order.indexOf('4:retire-items');
      const upsertItemsIdx = order.indexOf('5:upsert-items');
      expect(retireCompaniesIdx).toBeLessThan(upsertCompaniesIdx);
      expect(retireItemsIdx).toBeLessThan(upsertItemsIdx);
    });

    it('omits statement 3 (upsert companies) entirely when companyIds is [] — 4 statements only, the blanket retire already leaves zero elegibles', async () => {
      const { db, order, insertInto } = buildReemplazarDb();
      const repo = new KyselyOfferOpportunityRepository(UNUSED_DB);
      const tx = db as unknown as TransactionContext;

      await repo.reemplazar(buildSnapshot({ companyIds: [] }), tx);

      expect(order).toEqual([
        '1:upsert-cabecera',
        '2:retire-companies',
        '4:retire-items',
        '5:upsert-items',
      ]);
      expect(insertInto).not.toHaveBeenCalledWith('offer_opportunity_companies');
    });

    it('still writes the header when companyIds is [] — the header write is never suppressed', async () => {
      const { db, headerChain } = buildReemplazarDb();
      const repo = new KyselyOfferOpportunityRepository(UNUSED_DB);
      const tx = db as unknown as TransactionContext;

      await repo.reemplazar(buildSnapshot({ companyIds: [] }), tx);

      expect(headerChain.execute).toHaveBeenCalledTimes(1);
    });

    it('excludes cerrada_at from the header ON CONFLICT DO UPDATE SET (D-A.3) — closing is monotonic, satisfies 3b.3/3b.4 too', async () => {
      const { db, calls } = buildReemplazarDb();
      const repo = new KyselyOfferOpportunityRepository(UNUSED_DB);
      const tx = db as unknown as TransactionContext;

      await repo.reemplazar(buildSnapshot(), tx);

      expect(calls['header.onConflict.column']).toEqual([['refill_request_id']]);
      const [[headerSet]] = calls['header.onConflict.doUpdateSet']!;
      expect(Object.keys(headerSet as Record<string, unknown>)).not.toContain('cerrada_at');
      expect(headerSet).toMatchObject({
        user_id: 'user-1',
        comuna: 'Providencia',
        urgencia: 'hoy',
      });
    });

    it('the header INSERT values never carry cerrada_at either', async () => {
      const { db, headerChain } = buildReemplazarDb();
      const repo = new KyselyOfferOpportunityRepository(UNUSED_DB);
      const tx = db as unknown as TransactionContext;

      await repo.reemplazar(buildSnapshot(), tx);

      const [insertedValues] = headerChain.values.mock.calls[0] as [Record<string, unknown>];
      expect(Object.keys(insertedValues)).not.toContain('cerrada_at');
      expect(insertedValues).toMatchObject({
        refill_request_id: 'request-1',
        user_id: 'user-1',
        comuna: 'Providencia',
        urgencia: 'hoy',
      });
    });

    it('bulk-inserts ALL companies in ONE multi-row statement, never N round-trips', async () => {
      const { db, upsertCompaniesChain } = buildReemplazarDb();
      const repo = new KyselyOfferOpportunityRepository(UNUSED_DB);
      const tx = db as unknown as TransactionContext;

      await repo.reemplazar(
        buildSnapshot({ companyIds: ['company-a', 'company-b', 'company-c'] }),
        tx,
      );

      expect(upsertCompaniesChain.values).toHaveBeenCalledTimes(1);
      const [rows] = upsertCompaniesChain.values.mock.calls[0] as [unknown[]];
      expect(rows).toHaveLength(3);
    });

    it('companies upsert conflicts on (refill_request_id, company_id) and sets vigente=true (constant, safe as a static literal across all conflicting rows)', async () => {
      const { db, calls } = buildReemplazarDb();
      const repo = new KyselyOfferOpportunityRepository(UNUSED_DB);
      const tx = db as unknown as TransactionContext;

      await repo.reemplazar(buildSnapshot(), tx);

      expect(calls['companies.onConflict.columns']).toEqual([
        [['refill_request_id', 'company_id']],
      ]);
      const [[companiesSet]] = calls['companies.onConflict.doUpdateSet']!;
      expect(companiesSet).toEqual({ vigente: true });
    });

    it('bulk-inserts ALL items in ONE multi-row statement, never N round-trips', async () => {
      const { db, upsertItemsChain } = buildReemplazarDb();
      const repo = new KyselyOfferOpportunityRepository(UNUSED_DB);
      const tx = db as unknown as TransactionContext;

      await repo.reemplazar(
        buildSnapshot({
          items: [
            snapshotItem({ refillItemId: 'refill-item-1' }),
            snapshotItem({ refillItemId: 'refill-item-2' }),
          ],
        }),
        tx,
      );

      expect(upsertItemsChain.values).toHaveBeenCalledTimes(1);
      const [rows] = upsertItemsChain.values.mock.calls[0] as [unknown[]];
      expect(rows).toHaveLength(2);
    });

    it('items upsert conflicts on refill_item_id and uses PER-ROW excluded refs for nombre/categoria/precio_referencia/catalog_product_id — a static literal here would corrupt a multi-item batch', async () => {
      const { db, calls } = buildReemplazarDb();
      const repo = new KyselyOfferOpportunityRepository(UNUSED_DB);
      const tx = db as unknown as TransactionContext;

      await repo.reemplazar(buildSnapshot(), tx);

      expect(calls['items.onConflict.column']).toEqual([['refill_item_id']]);
      expect(calls['items.onConflict.doUpdateSet.wasCallback']).toEqual([[true]]);
      const [[itemsSet]] = calls['items.onConflict.doUpdateSet']!;
      expect(itemsSet).toMatchObject({
        nombre: excludedRef('excluded.nombre'),
        categoria: excludedRef('excluded.categoria'),
        precio_referencia: excludedRef('excluded.precio_referencia'),
        catalog_product_id: excludedRef('excluded.catalog_product_id'),
        vigente: true,
      });
    });

    it('formats precio_referencia into the numeric-column string shape on item insert', async () => {
      const { db, upsertItemsChain } = buildReemplazarDb();
      const repo = new KyselyOfferOpportunityRepository(UNUSED_DB);
      const tx = db as unknown as TransactionContext;

      await repo.reemplazar(
        buildSnapshot({ items: [snapshotItem({ precioReferencia: 12990 })] }),
        tx,
      );

      const [rows] = upsertItemsChain.values.mock.calls[0] as [Record<string, unknown>[]];
      expect(rows[0]).toMatchObject({ precio_referencia: '12990.00' });
    });

    it('carries catalog_product_id NULL through to the item insert when the snapshot item has none', async () => {
      const { db, upsertItemsChain } = buildReemplazarDb();
      const repo = new KyselyOfferOpportunityRepository(UNUSED_DB);
      const tx = db as unknown as TransactionContext;

      await repo.reemplazar(
        buildSnapshot({ items: [snapshotItem({ catalogProductId: null })] }),
        tx,
      );

      const [rows] = upsertItemsChain.values.mock.calls[0] as [Record<string, unknown>[]];
      expect(rows[0]).toMatchObject({ catalog_product_id: null });
    });

    it('retire predicates: refill_request_id = $R AND vigente = true, for BOTH companies and items', async () => {
      const { db, calls } = buildReemplazarDb();
      const repo = new KyselyOfferOpportunityRepository(UNUSED_DB);
      const tx = db as unknown as TransactionContext;

      await repo.reemplazar(buildSnapshot(), tx);

      expect(calls['retireCompanies.set']).toEqual([[{ vigente: false }]]);
      expect(calls['retireCompanies.where']).toEqual([
        ['refill_request_id', '=', 'request-1'],
        ['vigente', '=', true],
      ]);
      expect(calls['retireItems.set']).toEqual([[{ vigente: false }]]);
      expect(calls['retireItems.where']).toEqual([
        ['refill_request_id', '=', 'request-1'],
        ['vigente', '=', true],
      ]);
    });

    it('runs every one of the 5 statements against the SAME tx — no statement falls back to the constructor db', async () => {
      const { db: unusedTxDb } = buildReemplazarDb();
      const { db: txDb, order } = buildReemplazarDb();
      const repo = new KyselyOfferOpportunityRepository(unusedTxDb);
      const tx = txDb as unknown as TransactionContext;

      await repo.reemplazar(buildSnapshot(), tx);

      expect(order).toHaveLength(5);
    });
  });

  describe('findElegible — cabecera + items VIGENTES as RefillItem[] (tasks.md 3b.5/3b.6, D11/D8)', () => {
    function buildFindElegibleDb(
      headerRow: Record<string, unknown> | undefined,
      itemRows: Record<string, unknown>[],
    ) {
      const calls: Record<string, unknown[][]> = {};
      const record = (method: string, args: unknown[]) => {
        (calls[method] ??= []).push(args);
      };

      const headerChain: Record<string, jest.Mock> = {};
      headerChain.innerJoin = jest.fn((...args: unknown[]) => {
        record('header.innerJoin', args);
        return headerChain;
      });
      headerChain.select = jest.fn((...args: unknown[]) => {
        record('header.select', args);
        return headerChain;
      });
      headerChain.where = jest.fn((...args: unknown[]) => {
        record('header.where', args);
        return headerChain;
      });
      headerChain.executeTakeFirst = jest.fn(async () => headerRow);

      const itemsChain: Record<string, jest.Mock> = {};
      itemsChain.select = jest.fn((...args: unknown[]) => {
        record('items.select', args);
        return itemsChain;
      });
      itemsChain.where = jest.fn((...args: unknown[]) => {
        record('items.where', args);
        return itemsChain;
      });
      itemsChain.execute = jest.fn(async () => itemRows);

      const selectFrom = jest.fn((table: string) => {
        record('selectFrom', [table]);
        if (table === 'offer_opportunity_companies as c') return headerChain;
        if (table === 'offer_opportunity_items') return itemsChain;
        throw new Error(`unexpected selectFrom: ${table}`);
      });

      const db = { selectFrom } as unknown as Kysely<DB>;
      return { db, calls, headerChain, itemsChain, selectFrom };
    }

    function headerRow(overrides: Record<string, unknown> = {}) {
      return {
        refill_request_id: 'request-1',
        user_id: 'user-1',
        comuna: 'Providencia',
        urgencia: 'hoy' as RefillUrgenciaRow,
        cerrada_at: null,
        ...overrides,
      };
    }

    function itemRow(overrides: Record<string, unknown> = {}) {
      return {
        refill_item_id: 'refill-item-1',
        nombre: 'Royal Canin 15kg',
        categoria: 'alimento',
        precio_referencia: '45990.00',
        catalog_product_id: 'catalog-product-1',
        ...overrides,
      };
    }

    it('returns null when the company is NOT currently vigente for this refillRequestId', async () => {
      const { db } = buildFindElegibleDb(undefined, []);
      const repo = new KyselyOfferOpportunityRepository(db);

      await expect(repo.findElegible('request-1', 'company-a')).resolves.toBeNull();
    });

    it('returns null when the refillRequestId does not exist at all — same null as "not eligible", the caller cannot tell them apart', async () => {
      const { db } = buildFindElegibleDb(undefined, []);
      const repo = new KyselyOfferOpportunityRepository(db);

      await expect(repo.findElegible('missing-request', 'company-a')).resolves.toBeNull();
    });

    it('returns OportunidadElegible with items mapped 1:1 to RefillItem[] when eligible', async () => {
      const { db } = buildFindElegibleDb(headerRow(), [itemRow()]);
      const repo = new KyselyOfferOpportunityRepository(db);

      const result = await repo.findElegible('request-1', 'company-a');

      expect(result).toEqual({
        refillRequestId: 'request-1',
        userId: 'user-1',
        comuna: 'Providencia',
        urgencia: 'hoy',
        cerradaAt: null,
        items: [
          {
            id: 'refill-item-1',
            nombre: 'Royal Canin 15kg',
            categoria: 'alimento',
            precioReferencia: 45990,
            catalogProductId: 'catalog-product-1',
          },
        ],
      });
    });

    it('maps a NULL catalog_product_id to undefined (never null) on the RefillItem shape', async () => {
      const { db } = buildFindElegibleDb(headerRow(), [itemRow({ catalog_product_id: null })]);
      const repo = new KyselyOfferOpportunityRepository(db);

      const result = await repo.findElegible('request-1', 'company-a');

      expect(result!.items[0]!.catalogProductId).toBeUndefined();
    });

    it('filters the eligibility check on c.vigente = true and the items read on i.vigente = true', async () => {
      const { db, calls } = buildFindElegibleDb(headerRow(), [itemRow()]);
      const repo = new KyselyOfferOpportunityRepository(db);

      await repo.findElegible('request-1', 'company-a');

      expect(calls['header.where']).toEqual([
        ['c.refill_request_id', '=', 'request-1'],
        ['c.company_id', '=', 'company-a'],
        ['c.vigente', '=', true],
      ]);
      expect(calls['items.where']).toEqual([
        ['refill_request_id', '=', 'request-1'],
        ['vigente', '=', true],
      ]);
    });

    it('does NOT filter by cerrada_at — a closed opportunity is still returned, the caller (enviarOferta) decides the 409', async () => {
      const { db } = buildFindElegibleDb(headerRow({ cerrada_at: '2026-08-10T12:00:00.000Z' }), [
        itemRow(),
      ]);
      const repo = new KyselyOfferOpportunityRepository(db);

      const result = await repo.findElegible('request-1', 'company-a');

      expect(result).not.toBeNull();
      expect(result!.cerradaAt).toBe('2026-08-10T12:00:00.000Z');
    });
  });

  describe('listarPorCompany — 1 query, 2 joins, no userId (tasks.md 3b.7/3b.8, D-E, Diagrama 3)', () => {
    function buildListarDb(rows: Record<string, unknown>[]) {
      const calls: Record<string, unknown[][]> = {};
      const record = (method: string, args: unknown[]) => {
        (calls[method] ??= []).push(args);
      };
      const chain: Record<string, jest.Mock> = {};
      chain.innerJoin = jest.fn((...args: unknown[]) => {
        record('innerJoin', args);
        return chain;
      });
      chain.select = jest.fn((...args: unknown[]) => {
        record('select', args);
        return chain;
      });
      chain.where = jest.fn((...args: unknown[]) => {
        record('where', args);
        return chain;
      });
      chain.execute = jest.fn(async () => rows);
      const selectFrom = jest.fn((...args: unknown[]) => {
        record('selectFrom', args);
        return chain;
      });
      const db = { selectFrom } as unknown as Kysely<DB>;
      return { db, calls, chain, selectFrom };
    }

    function listarRow(overrides: Record<string, unknown> = {}) {
      return {
        refill_request_id: 'request-1',
        comuna: 'Providencia',
        urgencia: 'hoy' as RefillUrgenciaRow,
        matched_at: '2026-08-12T10:00:00.000Z',
        refill_item_id: 'refill-item-1',
        nombre: 'Royal Canin 15kg',
        categoria: 'alimento',
        precio_referencia: '45990.00',
        catalog_product_id: 'catalog-product-1',
        ...overrides,
      };
    }

    it('returns [] when nothing matches', async () => {
      const { db } = buildListarDb([]);
      const repo = new KyselyOfferOpportunityRepository(db);

      await expect(repo.listarPorCompany('company-a')).resolves.toEqual([]);
    });

    it('queries with exactly the Diagrama 3 shape: 1 selectFrom + 2 innerJoin, filtered on c.company_id/c.vigente/o.cerrada_at is null/i.vigente', async () => {
      const { db, calls } = buildListarDb([listarRow()]);
      const repo = new KyselyOfferOpportunityRepository(db);

      await repo.listarPorCompany('company-a');

      expect(calls['selectFrom']).toEqual([['offer_opportunity_companies as c']]);
      expect(calls['innerJoin']).toEqual([
        ['offer_opportunities as o', 'o.refill_request_id', 'c.refill_request_id'],
        ['offer_opportunity_items as i', 'i.refill_request_id', 'o.refill_request_id'],
      ]);
      expect(calls['where']).toEqual([
        ['c.company_id', '=', 'company-a'],
        ['c.vigente', '=', true],
        ['o.cerrada_at', 'is', null],
        ['i.vigente', '=', true],
      ]);
    });

    it('groups items inline per solicitud — 1 solicitud with 2 items collapses into ONE SolicitudElegible, never a duplicate', async () => {
      const { db } = buildListarDb([
        listarRow({ refill_item_id: 'refill-item-1' }),
        listarRow({ refill_item_id: 'refill-item-2', nombre: 'Otro producto' }),
      ]);
      const repo = new KyselyOfferOpportunityRepository(db);

      const result = await repo.listarPorCompany('company-a');

      expect(result).toHaveLength(1);
      expect(result[0]!.items).toHaveLength(2);
    });

    it('groups 2 different solicitudes into 2 SolicitudElegible, each with its own items inline — no N+1 follow-up query', async () => {
      const { db, chain } = buildListarDb([
        listarRow({ refill_request_id: 'request-1' }),
        listarRow({ refill_request_id: 'request-2' }),
      ]);
      const repo = new KyselyOfferOpportunityRepository(db);

      const result = await repo.listarPorCompany('company-a');

      expect(result).toHaveLength(2);
      expect(chain.execute).toHaveBeenCalledTimes(1);
    });

    it('the returned shape excludes userId entirely (Diagrama 3: the provider does not need to know the recipient profileId)', async () => {
      const { db } = buildListarDb([listarRow()]);
      const repo = new KyselyOfferOpportunityRepository(db);

      const result = await repo.listarPorCompany('company-a');

      expect(result[0]).not.toHaveProperty('userId');
      expect(Object.keys(result[0]!)).toEqual([
        'refillRequestId',
        'comuna',
        'urgencia',
        'matchedAt',
        'items',
      ]);
    });

    it('maps precio_referencia to a number and a NULL catalog_product_id to undefined', async () => {
      const { db } = buildListarDb([listarRow({ catalog_product_id: null })]);
      const repo = new KyselyOfferOpportunityRepository(db);

      const result = await repo.listarPorCompany('company-a');

      expect(result[0]!.items[0]!.precioReferencia).toBe(45990);
      expect(typeof result[0]!.items[0]!.precioReferencia).toBe('number');
      expect(result[0]!.items[0]!.catalogProductId).toBeUndefined();
    });
  });

  describe('existeRelacion — D10, "was this company ever eligible over any solicitud of this user" (tasks.md 3b.9/3b.10)', () => {
    function buildExisteRelacionDb(row: Record<string, unknown> | undefined) {
      const calls: Record<string, unknown[][]> = {};
      const record = (method: string, args: unknown[]) => {
        (calls[method] ??= []).push(args);
      };
      const chain: Record<string, jest.Mock> = {};
      chain.innerJoin = jest.fn((...args: unknown[]) => {
        record('innerJoin', args);
        return chain;
      });
      chain.select = jest.fn((...args: unknown[]) => {
        record('select', args);
        return chain;
      });
      chain.where = jest.fn((...args: unknown[]) => {
        record('where', args);
        return chain;
      });
      chain.limit = jest.fn((...args: unknown[]) => {
        record('limit', args);
        return chain;
      });
      chain.executeTakeFirst = jest.fn(async () => row);
      const selectFrom = jest.fn((...args: unknown[]) => {
        record('selectFrom', args);
        return chain;
      });
      const db = { selectFrom } as unknown as Kysely<DB>;
      return { db, calls, chain, selectFrom };
    }

    it('returns true when a prior match exists, even without acceptance (no vigente filter — "ever", not "currently")', async () => {
      const { db } = buildExisteRelacionDb({ refill_request_id: 'request-1' });
      const repo = new KyselyOfferOpportunityRepository(db);

      await expect(repo.existeRelacion('company-a', 'user-1')).resolves.toBe(true);
    });

    it('returns false when no relationship ever existed', async () => {
      const { db } = buildExisteRelacionDb(undefined);
      const repo = new KyselyOfferOpportunityRepository(db);

      await expect(repo.existeRelacion('company-a', 'user-1')).resolves.toBe(false);
    });

    it('filters on o.user_id and c.company_id, joined on refill_request_id, with NO vigente predicate', async () => {
      const { db, calls } = buildExisteRelacionDb({ refill_request_id: 'request-1' });
      const repo = new KyselyOfferOpportunityRepository(db);

      await repo.existeRelacion('company-a', 'user-1');

      expect(calls['innerJoin']).toEqual([
        ['offer_opportunity_companies as c', 'c.refill_request_id', 'o.refill_request_id'],
      ]);
      expect(calls['where']).toEqual([
        ['o.user_id', '=', 'user-1'],
        ['c.company_id', '=', 'company-a'],
      ]);
      const whereColumns = calls['where']!.map(([column]) => column);
      expect(whereColumns).not.toContain('c.vigente');
      expect(whereColumns).not.toContain('vigente');
    });

    it("limits to 1 row — existence only, never fetches the pair's full match history", async () => {
      const { db, calls } = buildExisteRelacionDb({ refill_request_id: 'request-1' });
      const repo = new KyselyOfferOpportunityRepository(db);

      await repo.existeRelacion('company-a', 'user-1');

      expect(calls['limit']).toEqual([[1]]);
    });
  });

  describe('cerrar — idempotent, monotonic UPDATE ... WHERE cerrada_at IS NULL (tasks.md 3b.11/3b.12, D12)', () => {
    function buildCerrarDb(numUpdatedRows = 1n) {
      const calls: Record<string, unknown[][]> = {};
      const record = (method: string, args: unknown[]) => {
        (calls[method] ??= []).push(args);
      };
      const chain: Record<string, jest.Mock> = {};
      chain.set = jest.fn((...args: unknown[]) => {
        record('set', args);
        return chain;
      });
      chain.where = jest.fn((...args: unknown[]) => {
        record('where', args);
        return chain;
      });
      chain.execute = jest.fn(async () => [{ numUpdatedRows }]);
      const updateTable = jest.fn((...args: unknown[]) => {
        record('updateTable', args);
        return chain;
      });
      const db = { updateTable } as unknown as Kysely<DB>;
      return { db, calls, chain, updateTable };
    }

    it('issues UPDATE offer_opportunities SET cerrada_at = <now> WHERE refill_request_id = $1 AND cerrada_at IS NULL', async () => {
      const { db, calls, updateTable } = buildCerrarDb();
      const repo = new KyselyOfferOpportunityRepository(UNUSED_DB);
      const tx = db as unknown as TransactionContext;

      await repo.cerrar('request-1', tx);

      expect(updateTable).toHaveBeenCalledWith('offer_opportunities');
      const [[setArg]] = calls['set']!;
      expect(Object.keys(setArg as Record<string, unknown>)).toEqual(['cerrada_at']);
      expect((setArg as Record<string, unknown>)['cerrada_at']).not.toBeNull();
      expect(calls['where']).toEqual([
        ['refill_request_id', '=', 'request-1'],
        ['cerrada_at', 'is', null],
      ]);
    });

    it('is idempotent by construction: calling it twice never throws, the WHERE clause is what makes the 2nd call a no-op', async () => {
      const { db } = buildCerrarDb(0n);
      const repo = new KyselyOfferOpportunityRepository(UNUSED_DB);
      const tx = db as unknown as TransactionContext;

      await expect(repo.cerrar('request-1', tx)).resolves.toBeUndefined();
      await expect(repo.cerrar('request-1', tx)).resolves.toBeUndefined();
    });

    it('propagates tx — never falls back to the constructor db', async () => {
      const { db: unusedTxDb } = buildCerrarDb();
      const { db: txDb, chain } = buildCerrarDb();
      const repo = new KyselyOfferOpportunityRepository(unusedTxDb);
      const tx = txDb as unknown as TransactionContext;

      await repo.cerrar('request-1', tx);

      expect(chain.execute).toHaveBeenCalledTimes(1);
    });
  });
});
