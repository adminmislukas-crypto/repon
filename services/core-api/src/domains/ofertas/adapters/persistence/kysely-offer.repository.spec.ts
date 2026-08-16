import type { Kysely } from 'kysely';
import { DatabaseError } from 'pg';
import type { Offer, OfferItemProactiva, OfferItemReactiva } from '@repon/types';
import type { DB } from '../../../../shared/database/schema';
import type { TransactionContext } from '../../../../shared/database/transaction';
import { OfertaYaAceptadaError } from '../../domain/oferta.errors';
import { KyselyOfferRepository } from './kysely-offer.repository';

// design.md's "El gotcha de numeric sigue vigente" callout: costo_despacho/
// total/precio (offers/offer_items) are numeric(12,2) -> STRING from the
// driver. alt_size/alt_qty are ALSO numeric and, unlike precio_referencia
// (offer_opportunity_items, NOT NULL), nullable — the same
// `Number(null) === 0` centinela risk refill-matching's PR3 named, tested
// explicitly in both directions (write: undefined -> NULL, read: NULL ->
// undefined, never 0) throughout this file.

// `marcarAceptada`/`desplazarHermanas` take `tx: TransactionContext`
// REQUIRED (design.md D-G.5) — the constructor's own `db` is never touched
// by either method, so tests for both pass this inert stand-in for the
// unused constructor argument, never a functioning mock.
const UNUSED_DB = {} as unknown as Kysely<DB>;

function itemReactiva(overrides: Partial<OfferItemReactiva> = {}): OfferItemReactiva {
  return {
    id: 'offer-item-1',
    nombre: 'Agua 20L',
    refillItemId: 'refill-item-1',
    precio: 12990,
    isAlt: false,
    ...overrides,
  } as OfferItemReactiva;
}

function itemProactiva(overrides: Partial<OfferItemProactiva> = {}): OfferItemProactiva {
  return {
    id: 'offer-item-2',
    nombre: 'Bidón 10L',
    providerCatalogItemId: 'catalog-item-1',
    precio: 15990,
    isAlt: false,
    ...overrides,
  } as OfferItemProactiva;
}

function reactivaOfferFixture(overrides: Partial<Offer> = {}): Offer {
  return {
    id: 'offer-1',
    userId: 'user-1',
    companyId: 'company-1',
    status: 'pendiente',
    tiempoEntregaHoras: 24,
    costoDespacho: 2000,
    total: 14990,
    mensaje: undefined,
    kind: 'reactiva',
    refillRequestId: 'request-1',
    items: [itemReactiva()],
    ...overrides,
  } as Offer;
}

function proactivaOfferFixture(overrides: Partial<Offer> = {}): Offer {
  return {
    id: 'offer-2',
    userId: 'user-2',
    companyId: 'company-1',
    status: 'pendiente',
    tiempoEntregaHoras: 24,
    costoDespacho: 2000,
    total: 17990,
    mensaje: undefined,
    kind: 'proactiva',
    items: [itemProactiva()],
    ...overrides,
  } as Offer;
}

// ============================================================
// findById / findByUser / findByRefillRequest mock harness (tasks.md
// 3a.3-3a.6, 3a.11). All 3 reads share the same 1-query-with-join shape as
// `KyselyRefillRepository.findById` — items inline, no N+1.
// ============================================================

interface JoinRow {
  offer_id: string;
  user_id: string;
  refill_request_id: string | null;
  company_id: string;
  kind: 'reactiva' | 'proactiva';
  status: 'pendiente' | 'aceptada' | 'rechazada' | 'expirada';
  tiempo_entrega_horas: number;
  costo_despacho: string;
  total: string;
  mensaje: string | null;
  item_id: string;
  nombre: string;
  refill_item_id: string | null;
  provider_catalog_item_id: string | null;
  is_alt: boolean;
  alt_size: string | null;
  alt_qty: string | null;
  alt_note: string | null;
  precio: string;
}

function reactivaJoinRow(overrides: Partial<JoinRow> = {}): JoinRow {
  return {
    offer_id: 'offer-1',
    user_id: 'user-1',
    refill_request_id: 'request-1',
    company_id: 'company-1',
    kind: 'reactiva',
    status: 'pendiente',
    tiempo_entrega_horas: 24,
    costo_despacho: '2000.00',
    total: '14990.00',
    mensaje: null,
    item_id: 'item-1',
    nombre: 'Agua 20L',
    refill_item_id: 'refill-item-1',
    provider_catalog_item_id: null,
    is_alt: false,
    alt_size: null,
    alt_qty: null,
    alt_note: null,
    precio: '12990.00',
    ...overrides,
  };
}

function proactivaJoinRow(overrides: Partial<JoinRow> = {}): JoinRow {
  return {
    offer_id: 'offer-2',
    user_id: 'user-2',
    refill_request_id: null,
    company_id: 'company-1',
    kind: 'proactiva',
    status: 'pendiente',
    tiempo_entrega_horas: 24,
    costo_despacho: '2000.00',
    total: '17990.00',
    mensaje: null,
    item_id: 'item-2',
    nombre: 'Bidón 10L',
    refill_item_id: null,
    provider_catalog_item_id: 'catalog-item-1',
    is_alt: false,
    alt_size: null,
    alt_qty: null,
    alt_note: null,
    precio: '15990.00',
    ...overrides,
  };
}

function buildJoinSelectDb(rows: JoinRow[]) {
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
  return { db, calls, chain };
}

// ============================================================
// marcarAceptada() mock harness (tasks.md 3a.7/3a.8, R4). `tx` is REQUIRED
// (design.md D-G.5) — the mock DB stands in for `toKyselyTransaction(tx)`.
// ============================================================

function fakeUniqueViolation(constraint: string): DatabaseError {
  const error = new DatabaseError('duplicate key value violates unique constraint', 0, 'error');
  error.code = '23505';
  error.constraint = constraint;
  return error;
}

function buildMarcarAceptadaDb(rejectWith?: unknown) {
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
  chain.execute = jest.fn(async () => {
    if (rejectWith !== undefined) {
      throw rejectWith;
    }
    return undefined;
  });
  const updateTable = jest.fn((...args: unknown[]) => {
    record('updateTable', args);
    return chain;
  });
  const db = { updateTable } as unknown as Kysely<DB>;
  return { db, calls, chain, updateTable };
}

// ============================================================
// desplazarHermanas() mock harness (tasks.md 3a.9/3a.10, D-D). `tx` is
// REQUIRED (design.md D-G.5); the statement carries its own `RETURNING id`
// — no prior SELECT is ever mocked here, on purpose (there is none to mock).
// ============================================================

function buildDesplazarHermanasDb(returningRows: { id: string }[]) {
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
  chain.returning = jest.fn((...args: unknown[]) => {
    record('returning', args);
    return chain;
  });
  chain.execute = jest.fn(async () => returningRows);
  const updateTable = jest.fn((...args: unknown[]) => {
    record('updateTable', args);
    return chain;
  });
  const db = { updateTable } as unknown as Kysely<DB>;
  return { db, calls, chain, updateTable };
}

// ============================================================
// save() mock harness (tasks.md 3a.1/3a.2) — INSERT-only: `Offer` entities
// are immutable once persisted (design.md D-D: acceptance is a narrow
// `marcarAceptada` UPDATE, never a `save()` that rewrites items), so unlike
// `KyselyRefillRepository.save()` there is no existence check / UPDATE path
// to mock here.
// ============================================================

function buildSaveDb() {
  const calls: Record<string, unknown[][]> = {};
  const record = (method: string, args: unknown[]) => {
    (calls[method] ??= []).push(args);
  };

  const offersInsertChain: Record<string, jest.Mock> = {};
  offersInsertChain.values = jest.fn((...args: unknown[]) => {
    record('offersInsertValues', args);
    return offersInsertChain;
  });
  offersInsertChain.execute = jest.fn(async () => undefined);

  const itemsInsertChain: Record<string, jest.Mock> = {};
  itemsInsertChain.values = jest.fn((...args: unknown[]) => {
    record('itemsInsertValues', args);
    return itemsInsertChain;
  });
  itemsInsertChain.execute = jest.fn(async () => undefined);

  const insertInto = jest.fn((table: string) => {
    record('insertInto', [table]);
    return table === 'offers' ? offersInsertChain : itemsInsertChain;
  });

  const db = { insertInto } as unknown as Kysely<DB>;
  return { db, calls, offersInsertChain, itemsInsertChain, insertInto };
}

describe('KyselyOfferRepository', () => {
  describe('save — INSERT-only write, NEW reactiva/proactiva Offer (tasks.md 3a.1/3a.2)', () => {
    it('inserts exactly ONE row into offers with status EXPLICIT (never the column default)', async () => {
      const { db, offersInsertChain } = buildSaveDb();
      const repo = new KyselyOfferRepository(db);

      await repo.save(reactivaOfferFixture({ status: 'pendiente' }));

      expect(offersInsertChain.values).toHaveBeenCalledTimes(1);
      const [insertedValues] = offersInsertChain.values.mock.calls[0] as [Record<string, unknown>];
      expect(insertedValues).toHaveProperty('status', 'pendiente');
      expect(Object.keys(insertedValues)).toContain('status');
    });

    it('bulk-inserts ALL items in ONE multi-row statement, never N round-trips', async () => {
      const { db, itemsInsertChain } = buildSaveDb();
      const repo = new KyselyOfferRepository(db);

      await repo.save(
        reactivaOfferFixture({
          items: [itemReactiva(), itemReactiva({ refillItemId: 'refill-item-2' })],
        }),
      );

      expect(itemsInsertChain.values).toHaveBeenCalledTimes(1);
      expect(itemsInsertChain.execute).toHaveBeenCalledTimes(1);
      const [itemRows] = itemsInsertChain.values.mock.calls[0] as [unknown[]];
      expect(itemRows).toHaveLength(2);
    });

    it('formats costo_despacho/total/precio into the numeric-column string shape on insert', async () => {
      const { db, offersInsertChain, itemsInsertChain } = buildSaveDb();
      const repo = new KyselyOfferRepository(db);

      await repo.save(
        reactivaOfferFixture({
          costoDespacho: 2000,
          total: 14990,
          items: [itemReactiva({ precio: 12990 })],
        }),
      );

      const [offerRow] = offersInsertChain.values.mock.calls[0] as [Record<string, unknown>];
      expect(offerRow).toMatchObject({ costo_despacho: '2000.00', total: '14990.00' });
      const [itemRows] = itemsInsertChain.values.mock.calls[0] as [Record<string, unknown>[]];
      expect(itemRows[0]).toMatchObject({ precio: '12990.00' });
    });

    // backend-core-api-pedidos-pagos design.md D-B.4 (PR4): `id`/`nombre`
    // dejan de descartarse. `id` viene de la factory (`randomUUID()`, nunca
    // el default `Generated<string>` de la columna); `nombre` ya resuelto
    // por el caso de uso antes de llegar acá.
    it('writes id and nombre explicitly, never relying on the id column default', async () => {
      const { db, itemsInsertChain } = buildSaveDb();
      const repo = new KyselyOfferRepository(db);

      await repo.save(
        reactivaOfferFixture({
          items: [itemReactiva({ id: 'offer-item-9', nombre: 'Agua 20L' })],
        }),
      );

      const [itemRows] = itemsInsertChain.values.mock.calls[0] as [Record<string, unknown>[]];
      expect(itemRows[0]).toMatchObject({ id: 'offer-item-9', nombre: 'Agua 20L' });
    });

    it('writes alt_size/alt_qty as NULL (never "0") when the domain item omits them', async () => {
      const { db, itemsInsertChain } = buildSaveDb();
      const repo = new KyselyOfferRepository(db);

      await repo.save(
        reactivaOfferFixture({ items: [itemReactiva({ altSize: undefined, altQty: undefined })] }),
      );

      const [itemRows] = itemsInsertChain.values.mock.calls[0] as [Record<string, unknown>[]];
      expect(itemRows[0]).toMatchObject({ alt_size: null, alt_qty: null });
      expect(itemRows[0]).not.toMatchObject({ alt_size: '0', alt_qty: '0' });
    });

    it('writes alt_size/alt_qty as numeric strings when the domain item carries them (isAlt item)', async () => {
      const { db, itemsInsertChain } = buildSaveDb();
      const repo = new KyselyOfferRepository(db);

      await repo.save(
        reactivaOfferFixture({
          items: [
            itemReactiva({
              isAlt: true,
              altNote: 'Saco 25kg equivale a 15kg',
              altSize: 25,
              altQty: 1,
            }),
          ],
        }),
      );

      const [itemRows] = itemsInsertChain.values.mock.calls[0] as [Record<string, unknown>[]];
      expect(itemRows[0]).toMatchObject({
        alt_size: '25',
        alt_qty: '1',
        alt_note: 'Saco 25kg equivale a 15kg',
      });
    });

    it('sets refill_item_id and leaves provider_catalog_item_id NULL for a reactiva item', async () => {
      const { db, itemsInsertChain } = buildSaveDb();
      const repo = new KyselyOfferRepository(db);

      await repo.save(
        reactivaOfferFixture({ items: [itemReactiva({ refillItemId: 'refill-item-9' })] }),
      );

      const [itemRows] = itemsInsertChain.values.mock.calls[0] as [Record<string, unknown>[]];
      expect(itemRows[0]).toMatchObject({
        refill_item_id: 'refill-item-9',
        provider_catalog_item_id: null,
      });
    });

    it('sets provider_catalog_item_id and leaves refill_item_id NULL for a proactiva item', async () => {
      const { db, itemsInsertChain } = buildSaveDb();
      const repo = new KyselyOfferRepository(db);

      await repo.save(
        proactivaOfferFixture({
          items: [itemProactiva({ providerCatalogItemId: 'catalog-item-9' })],
        }),
      );

      const [itemRows] = itemsInsertChain.values.mock.calls[0] as [Record<string, unknown>[]];
      expect(itemRows[0]).toMatchObject({
        refill_item_id: null,
        provider_catalog_item_id: 'catalog-item-9',
      });
    });

    it('sets refill_request_id NULL for a proactiva offer, and populated for a reactiva offer', async () => {
      const { db: db1, offersInsertChain: chain1 } = buildSaveDb();
      const repo1 = new KyselyOfferRepository(db1);
      await repo1.save(proactivaOfferFixture());
      const [proactivaRow] = chain1.values.mock.calls[0] as [Record<string, unknown>];
      expect(proactivaRow).toMatchObject({ refill_request_id: null });

      const { db: db2, offersInsertChain: chain2 } = buildSaveDb();
      const repo2 = new KyselyOfferRepository(db2);
      await repo2.save(reactivaOfferFixture({ refillRequestId: 'request-42' }));
      const [reactivaRow] = chain2.values.mock.calls[0] as [Record<string, unknown>];
      expect(reactivaRow).toMatchObject({ refill_request_id: 'request-42' });
    });

    it('propagates tx to both inserts (repo-wide convention)', async () => {
      const { db: unusedDb } = buildSaveDb();
      const { db: txDb, offersInsertChain, itemsInsertChain } = buildSaveDb();
      const repo = new KyselyOfferRepository(unusedDb);
      const tx = txDb as unknown as TransactionContext;

      await repo.save(reactivaOfferFixture(), tx);

      expect(offersInsertChain.execute).toHaveBeenCalledTimes(1);
      expect(itemsInsertChain.execute).toHaveBeenCalledTimes(1);
    });
  });

  // ==========================================================
  // findById() — 1 query with join, items inline (tasks.md 3a.3/3a.4)
  // ==========================================================
  describe('findById — Offer | null, items inline, 1 query with join (tasks.md 3a.3/3a.4)', () => {
    it('returns null when no rows match', async () => {
      const { db } = buildJoinSelectDb([]);
      const repo = new KyselyOfferRepository(db);

      await expect(repo.findById('missing')).resolves.toBeNull();
    });

    it('maps a reactiva offer: kind/refillRequestId/items[].refillItemId populated', async () => {
      const { db } = buildJoinSelectDb([reactivaJoinRow()]);
      const repo = new KyselyOfferRepository(db);

      const result = await repo.findById('offer-1');

      expect(result).not.toBeNull();
      expect(result!.kind).toBe('reactiva');
      expect((result as { refillRequestId: string }).refillRequestId).toBe('request-1');
      expect(result!.items[0]).toMatchObject({ refillItemId: 'refill-item-1', precio: 12990 });
    });

    // backend-core-api-pedidos-pagos design.md D-B.4/D-B.1 (PR4): `row.item_id`
    // ya NO se descarta -- verificado, no solo agregado. `nombre` se lee del
    // mismo join, sin round-trip nuevo.
    it('maps item_id/nombre onto items[].id/.nombre, never discarding item_id', async () => {
      const { db } = buildJoinSelectDb([
        reactivaJoinRow({ item_id: 'item-9', nombre: 'Agua 20L' }),
      ]);
      const repo = new KyselyOfferRepository(db);

      const result = await repo.findById('offer-1');

      expect(result!.items[0]).toMatchObject({ id: 'item-9', nombre: 'Agua 20L' });
    });

    it('maps a proactiva offer: kind/items[].providerCatalogItemId populated, refillRequestId absent', async () => {
      const { db } = buildJoinSelectDb([proactivaJoinRow()]);
      const repo = new KyselyOfferRepository(db);

      const result = await repo.findById('offer-2');

      expect(result).not.toBeNull();
      expect(result!.kind).toBe('proactiva');
      expect((result as { refillRequestId?: string }).refillRequestId).toBeUndefined();
      expect(result!.items[0]).toMatchObject({
        providerCatalogItemId: 'catalog-item-1',
        precio: 15990,
      });
    });

    it("maps costo_despacho/total/precio numeric strings to numbers, typeof 'number'", async () => {
      const { db } = buildJoinSelectDb([reactivaJoinRow()]);
      const repo = new KyselyOfferRepository(db);

      const result = await repo.findById('offer-1');

      expect(result!.costoDespacho).toBe(2000);
      expect(typeof result!.costoDespacho).toBe('number');
      expect(result!.total).toBe(14990);
      expect(result!.items[0]!.precio).toBe(12990);
    });

    it('maps alt_size/alt_qty NULL to undefined explicitly — NEVER 0 (tasks.md 3a.3, numeric-mapper gotcha)', async () => {
      const { db } = buildJoinSelectDb([reactivaJoinRow({ alt_size: null, alt_qty: null })]);
      const repo = new KyselyOfferRepository(db);

      const result = await repo.findById('offer-1');

      expect(result!.items[0]!.altSize).toBeUndefined();
      expect(result!.items[0]!.altQty).toBeUndefined();
      expect(result!.items[0]!.altSize).not.toBe(0);
      expect(result!.items[0]!.altQty).not.toBe(0);
    });

    it('maps alt_size/alt_qty numeric strings to numbers when present (isAlt item)', async () => {
      const { db } = buildJoinSelectDb([
        reactivaJoinRow({
          is_alt: true,
          alt_size: '25.00',
          alt_qty: '1.00',
          alt_note: 'Saco 25kg',
        }),
      ]);
      const repo = new KyselyOfferRepository(db);

      const result = await repo.findById('offer-1');

      expect(result!.items[0]!.altSize).toBe(25);
      expect(result!.items[0]!.altQty).toBe(1);
      expect(result!.items[0]!.altNote).toBe('Saco 25kg');
    });

    it('collapses a multi-row join (2 items on the same offer) into ONE Offer with 2 items inline', async () => {
      const { db } = buildJoinSelectDb([
        reactivaJoinRow({ item_id: 'item-1', refill_item_id: 'refill-item-1' }),
        reactivaJoinRow({ item_id: 'item-2', refill_item_id: 'refill-item-2' }),
      ]);
      const repo = new KyselyOfferRepository(db);

      const result = await repo.findById('offer-1');

      expect(result!.items).toHaveLength(2);
    });

    it('queries with a single SELECT + JOIN against offer_items on offer_id', async () => {
      const { db, calls } = buildJoinSelectDb([reactivaJoinRow()]);
      const repo = new KyselyOfferRepository(db);

      await repo.findById('offer-1');

      expect(calls['selectFrom']).toEqual([['offers as o']]);
      expect(calls['innerJoin']).toEqual([['offer_items as i', 'i.offer_id', 'o.id']]);
      expect(calls['where']).toEqual([['o.id', '=', 'offer-1']]);
    });

    it('propagates tx (repo-wide convention)', async () => {
      const { db: unusedDb } = buildJoinSelectDb([reactivaJoinRow()]);
      const { db: txDb, chain } = buildJoinSelectDb([reactivaJoinRow()]);
      const repo = new KyselyOfferRepository(unusedDb);
      const tx = txDb as unknown as TransactionContext;

      await repo.findById('offer-1', tx);

      expect(chain.execute).toHaveBeenCalledTimes(1);
    });
  });

  // ==========================================================
  // findByUser() — obtenerBandeja's read (tasks.md 3a.5/3a.6)
  // ==========================================================
  describe("findByUser — obtenerBandeja's read, items inline, no N+1 (tasks.md 3a.5/3a.6)", () => {
    it('returns [] when no rows match', async () => {
      const { db } = buildJoinSelectDb([]);
      const repo = new KyselyOfferRepository(db);

      await expect(repo.findByUser('user-1')).resolves.toEqual([]);
    });

    it('groups rows by offer_id: 2 offers (1 item each) collapse into 2 Offers, each with 1 item inline', async () => {
      const { db } = buildJoinSelectDb([
        reactivaJoinRow({ offer_id: 'offer-1', item_id: 'item-1' }),
        reactivaJoinRow({ offer_id: 'offer-3', item_id: 'item-3', refill_request_id: 'request-3' }),
      ]);
      const repo = new KyselyOfferRepository(db);

      const result = await repo.findByUser('user-1');

      expect(result).toHaveLength(2);
      expect(result.map((o) => o.id)).toEqual(['offer-1', 'offer-3']);
      expect(result[0]!.items).toHaveLength(1);
      expect(result[1]!.items).toHaveLength(1);
    });

    it('collapses a multi-row join (1 offer, 2 items) into ONE Offer, never a duplicate', async () => {
      const { db } = buildJoinSelectDb([
        reactivaJoinRow({
          offer_id: 'offer-1',
          item_id: 'item-1',
          refill_item_id: 'refill-item-1',
        }),
        reactivaJoinRow({
          offer_id: 'offer-1',
          item_id: 'item-2',
          refill_item_id: 'refill-item-2',
        }),
      ]);
      const repo = new KyselyOfferRepository(db);

      const result = await repo.findByUser('user-1');

      expect(result).toHaveLength(1);
      expect(result[0]!.items).toHaveLength(2);
    });

    it('queries with a single SELECT + JOIN filtered on user_id — no per-offer follow-up query', async () => {
      const { db, calls } = buildJoinSelectDb([reactivaJoinRow()]);
      const repo = new KyselyOfferRepository(db);

      await repo.findByUser('user-1');

      expect(calls['selectFrom']).toEqual([['offers as o']]);
      expect(calls['innerJoin']).toEqual([['offer_items as i', 'i.offer_id', 'o.id']]);
      expect(calls['where']).toEqual([['o.user_id', '=', 'user-1']]);
    });

    it('propagates tx (repo-wide convention)', async () => {
      const { db: unusedDb } = buildJoinSelectDb([reactivaJoinRow()]);
      const { db: txDb, chain } = buildJoinSelectDb([reactivaJoinRow()]);
      const repo = new KyselyOfferRepository(unusedDb);
      const tx = txDb as unknown as TransactionContext;

      await repo.findByUser('user-1', tx);

      expect(chain.execute).toHaveBeenCalledTimes(1);
    });
  });

  // ==========================================================
  // marcarAceptada() — narrow 1-column UPDATE + 23505 translation
  // (tasks.md 3a.7/3a.8, R4)
  // ==========================================================
  describe('marcarAceptada — narrow UPDATE, never a save() that rewrites items (tasks.md 3a.7/3a.8, R4)', () => {
    it('issues a single narrow UPDATE offers SET status = aceptada WHERE id = $1', async () => {
      const { db, calls } = buildMarcarAceptadaDb();
      const repo = new KyselyOfferRepository(UNUSED_DB);
      const tx = db as unknown as TransactionContext;

      await repo.marcarAceptada('offer-1', tx);

      expect(calls['updateTable']).toEqual([['offers']]);
      expect(calls['set']).toEqual([[{ status: 'aceptada' }]]);
      expect(calls['where']).toEqual([['id', '=', 'offer-1']]);
    });

    it('translates a 23505 on offers_refill_request_id_aceptada_uidx into OfertaYaAceptadaError', async () => {
      const rejectWith = fakeUniqueViolation('offers_refill_request_id_aceptada_uidx');
      const { db } = buildMarcarAceptadaDb(rejectWith);
      const repo = new KyselyOfferRepository(UNUSED_DB);
      const tx = db as unknown as TransactionContext;

      await expect(repo.marcarAceptada('offer-1', tx)).rejects.toBeInstanceOf(
        OfertaYaAceptadaError,
      );
    });

    it('re-throws a 23505 on a DIFFERENT constraint as-is — never OfertaYaAceptadaError', async () => {
      const rejectWith = fakeUniqueViolation('some_other_constraint');
      const { db } = buildMarcarAceptadaDb(rejectWith);
      const repo = new KyselyOfferRepository(UNUSED_DB);
      const tx = db as unknown as TransactionContext;

      await expect(repo.marcarAceptada('offer-1', tx)).rejects.toBe(rejectWith);
    });

    it('re-throws any non-23505 driver error as-is (maps to 500, never 409)', async () => {
      const rejectWith = new Error('connection terminated unexpectedly');
      const { db } = buildMarcarAceptadaDb(rejectWith);
      const repo = new KyselyOfferRepository(UNUSED_DB);
      const tx = db as unknown as TransactionContext;

      await expect(repo.marcarAceptada('offer-1', tx)).rejects.toBe(rejectWith);
    });
  });

  // ==========================================================
  // desplazarHermanas() — UPDATE ... RETURNING id, no prior SELECT
  // (tasks.md 3a.9/3a.10, D-D)
  // ==========================================================
  describe('desplazarHermanas — single UPDATE ... RETURNING id, no prior SELECT (tasks.md 3a.9/3a.10, D-D)', () => {
    it('issues the exact predicate: refill_request_id = $1 AND id <> $2 AND status = pendiente', async () => {
      const { db, calls } = buildDesplazarHermanasDb([{ id: 'sibling-1' }, { id: 'sibling-2' }]);
      const repo = new KyselyOfferRepository(UNUSED_DB);
      const tx = db as unknown as TransactionContext;

      await repo.desplazarHermanas('request-1', 'offer-1', tx);

      expect(calls['updateTable']).toEqual([['offers']]);
      expect(calls['set']).toEqual([[{ status: 'rechazada' }]]);
      expect(calls['where']).toEqual([
        ['refill_request_id', '=', 'request-1'],
        ['id', '<>', 'offer-1'],
        ['status', '=', 'pendiente'],
      ]);
    });

    it("calls .returning('id') — never a SELECT beforehand", async () => {
      const { db, calls, updateTable } = buildDesplazarHermanasDb([{ id: 'sibling-1' }]);
      const repo = new KyselyOfferRepository(UNUSED_DB);
      const tx = db as unknown as TransactionContext;

      await repo.desplazarHermanas('request-1', 'offer-1', tx);

      expect(calls['returning']).toEqual([['id']]);
      expect(updateTable).toHaveBeenCalledTimes(1);
    });

    it('returns exactly the ids the statement moved — [] when nobody else was pendiente', async () => {
      const { db } = buildDesplazarHermanasDb([]);
      const repo = new KyselyOfferRepository(UNUSED_DB);
      const tx = db as unknown as TransactionContext;

      await expect(repo.desplazarHermanas('request-1', 'offer-1', tx)).resolves.toEqual([]);
    });

    it('returns the 2 displaced ids, in RETURNING order', async () => {
      const { db } = buildDesplazarHermanasDb([{ id: 'sibling-1' }, { id: 'sibling-2' }]);
      const repo = new KyselyOfferRepository(UNUSED_DB);
      const tx = db as unknown as TransactionContext;

      await expect(repo.desplazarHermanas('request-1', 'offer-1', tx)).resolves.toEqual([
        'sibling-1',
        'sibling-2',
      ]);
    });
  });

  // ==========================================================
  // findByRefillRequest() — declared, no caller added in this change
  // (tasks.md 3a.11, design.md D-G.1). Given a real trivial implementation
  // matching the port signature (tasks.md's own explicitly allowed option)
  // rather than a "not implemented" throw — the displacement in
  // `aceptarOferta` (Phase 7a) uses `desplazarHermanas`'s own `RETURNING`
  // instead, so this method stays unreferenced by any use case, but a
  // working implementation is cheaper to maintain than a landmine.
  // ==========================================================
  describe('findByRefillRequest — declared, unimplemented-beyond-the-interface caller-wise (tasks.md 3a.11)', () => {
    it('returns [] when no rows match', async () => {
      const { db } = buildJoinSelectDb([]);
      const repo = new KyselyOfferRepository(db);

      await expect(repo.findByRefillRequest('request-1')).resolves.toEqual([]);
    });

    it('queries with a single SELECT + JOIN filtered on refill_request_id, items inline', async () => {
      const { db, calls } = buildJoinSelectDb([reactivaJoinRow()]);
      const repo = new KyselyOfferRepository(db);

      const result = await repo.findByRefillRequest('request-1');

      expect(calls['where']).toEqual([['o.refill_request_id', '=', 'request-1']]);
      expect(result).toHaveLength(1);
      expect(result[0]!.items).toHaveLength(1);
    });

    it('propagates tx (repo-wide convention)', async () => {
      const { db: unusedDb } = buildJoinSelectDb([reactivaJoinRow()]);
      const { db: txDb, chain } = buildJoinSelectDb([reactivaJoinRow()]);
      const repo = new KyselyOfferRepository(unusedDb);
      const tx = txDb as unknown as TransactionContext;

      await repo.findByRefillRequest('request-1', tx);

      expect(chain.execute).toHaveBeenCalledTimes(1);
    });
  });
});
