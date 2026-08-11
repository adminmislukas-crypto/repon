import type { Kysely } from 'kysely';
import type { RefillRequestActiva, RefillRequestBorrador } from '@repon/types';
import type { DB } from '../../../../shared/database/schema';
import type { TransactionContext } from '../../../../shared/database/transaction';
import { KyselyRefillRepository, toRefillItem } from './kysely-refill.repository';

// design.md's "detalle mecánico de mayor riesgo del cambio": `precio_referencia`
// is a `numeric(12,2)` column — node-postgres returns it as a `string`, and it
// is ALSO nullable since batch 15 (D4). `Number(null) === 0` in JS, so a naive
// mapper turns a borrador's genuinely-unknown price into `precioReferencia: 0`
// — the exact centinela D3 exists to reject. Every `findById`/
// `findBorradorByConsumption` test below that touches a nullable column
// asserts `undefined` EXPLICITLY, never `0`, never `''`.

interface JoinRow {
  request_id: string;
  user_id: string;
  direccion: string | null;
  comuna: string | null;
  urgencia: string;
  estado: string;
  consumption_id: string | null;
  item_id: string;
  catalog_product_id: string | null;
  nombre: string;
  categoria: string | null;
  precio_referencia: string | null;
}

function completeJoinRow(overrides: Partial<JoinRow> = {}): JoinRow {
  return {
    request_id: 'request-1',
    user_id: 'user-1',
    direccion: 'Calle Falsa 123',
    comuna: 'Providencia',
    urgencia: 'hoy',
    estado: 'abierta',
    consumption_id: null,
    item_id: 'item-1',
    catalog_product_id: null,
    nombre: 'Alimento Perro',
    categoria: 'alimento',
    precio_referencia: '1990.00',
    ...overrides,
  };
}

function borradorJoinRow(overrides: Partial<JoinRow> = {}): JoinRow {
  return {
    request_id: 'request-borrador-1',
    user_id: 'user-1',
    direccion: null,
    comuna: null,
    urgencia: 'lo_antes_posible',
    estado: 'borrador',
    consumption_id: 'consumption-1',
    item_id: 'item-borrador-1',
    catalog_product_id: null,
    nombre: 'Alimento Perro',
    categoria: null,
    precio_referencia: null,
    ...overrides,
  };
}

function activaFixture(overrides: Partial<RefillRequestActiva> = {}): RefillRequestActiva {
  return {
    id: 'request-1',
    userId: 'user-1',
    urgencia: 'hoy',
    estado: 'abierta',
    direccion: 'Calle Falsa 123',
    comuna: 'Providencia',
    items: [
      {
        id: 'item-1',
        nombre: 'Alimento Perro',
        categoria: 'alimento',
        precioReferencia: 1990,
        catalogProductId: undefined,
      },
      {
        id: 'item-2',
        nombre: 'Arena Gato',
        categoria: 'higiene',
        precioReferencia: 4990,
        catalogProductId: undefined,
      },
    ],
    ...overrides,
  };
}

function borradorFixture(overrides: Partial<RefillRequestBorrador> = {}): RefillRequestBorrador {
  return {
    id: 'request-borrador-1',
    userId: 'user-1',
    urgencia: 'lo_antes_posible',
    consumptionId: 'consumption-1',
    estado: 'borrador',
    items: [{ id: 'item-borrador-1', nombre: 'Alimento Perro' }],
    ...overrides,
  };
}

// ============================================================
// save() mock harnesses
// ============================================================

function buildSaveNewDb() {
  const calls: Record<string, unknown[][]> = {};
  const record = (method: string, args: unknown[]) => {
    (calls[method] ??= []).push(args);
  };

  const existsChain: Record<string, jest.Mock> = {};
  existsChain.select = jest.fn((...args: unknown[]) => {
    record('select', args);
    return existsChain;
  });
  existsChain.where = jest.fn((...args: unknown[]) => {
    record('existsWhere', args);
    return existsChain;
  });
  existsChain.executeTakeFirst = jest.fn(async () => undefined);

  const requestInsertChain: Record<string, jest.Mock> = {};
  requestInsertChain.values = jest.fn((...args: unknown[]) => {
    record('requestInsertValues', args);
    return requestInsertChain;
  });
  requestInsertChain.execute = jest.fn(async () => undefined);

  const itemsInsertChain: Record<string, jest.Mock> = {};
  itemsInsertChain.values = jest.fn((...args: unknown[]) => {
    record('itemsInsertValues', args);
    return itemsInsertChain;
  });
  itemsInsertChain.execute = jest.fn(async () => undefined);

  const selectFrom = jest.fn((...args: unknown[]) => {
    record('selectFrom', args);
    return existsChain;
  });
  const insertInto = jest.fn((table: string) => {
    record('insertInto', [table]);
    return table === 'refill_requests' ? requestInsertChain : itemsInsertChain;
  });

  const db = { selectFrom, insertInto } as unknown as Kysely<DB>;
  return { db, calls, requestInsertChain, itemsInsertChain, selectFrom, insertInto };
}

function buildSaveUpdateDb() {
  const calls: Record<string, unknown[][]> = {};
  const record = (method: string, args: unknown[]) => {
    (calls[method] ??= []).push(args);
  };

  const existsChain: Record<string, jest.Mock> = {};
  existsChain.select = jest.fn((...args: unknown[]) => {
    record('select', args);
    return existsChain;
  });
  existsChain.where = jest.fn((...args: unknown[]) => {
    record('existsWhere', args);
    return existsChain;
  });
  existsChain.executeTakeFirst = jest.fn(async () => ({ id: 'request-borrador-1' }));

  const requestUpdateChain: Record<string, jest.Mock> = {};
  requestUpdateChain.set = jest.fn((...args: unknown[]) => {
    record('requestUpdateSet', args);
    return requestUpdateChain;
  });
  requestUpdateChain.where = jest.fn((...args: unknown[]) => {
    record('requestUpdateWhere', args);
    return requestUpdateChain;
  });
  requestUpdateChain.execute = jest.fn(async () => undefined);

  const itemUpdateSetCalls: unknown[][] = [];
  const itemUpdateWhereCalls: unknown[][] = [];

  const selectFrom = jest.fn((...args: unknown[]) => {
    record('selectFrom', args);
    return existsChain;
  });
  const updateTable = jest.fn((table: string) => {
    record('updateTable', [table]);
    if (table === 'refill_requests') {
      return requestUpdateChain;
    }
    // refill_items: a FRESH chain per call — one loop iteration per item.
    const chain: Record<string, jest.Mock> = {};
    chain.set = jest.fn((...args: unknown[]) => {
      itemUpdateSetCalls.push(args);
      return chain;
    });
    chain.where = jest.fn((...args: unknown[]) => {
      itemUpdateWhereCalls.push(args);
      return chain;
    });
    chain.execute = jest.fn(async () => undefined);
    return chain;
  });
  const insertInto = jest.fn();
  const deleteFrom = jest.fn();

  const db = { selectFrom, updateTable, insertInto, deleteFrom } as unknown as Kysely<DB>;
  return {
    db,
    calls,
    requestUpdateChain,
    itemUpdateSetCalls,
    itemUpdateWhereCalls,
    insertInto,
    deleteFrom,
  };
}

// ============================================================
// findById / findBorradorByConsumption mock harness
// ============================================================

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
// actualizarEstado mock harness
// ============================================================

function buildActualizarEstadoDb() {
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
  chain.execute = jest.fn(async () => undefined);
  const updateTable = jest.fn((...args: unknown[]) => {
    record('updateTable', args);
    return chain;
  });
  const selectFrom = jest.fn();
  const insertInto = jest.fn();
  const db = { updateTable, selectFrom, insertInto } as unknown as Kysely<DB>;
  return { db, calls, chain, selectFrom, insertInto };
}

describe('KyselyRefillRepository', () => {
  // ==========================================================
  // save() — NEW entity (tasks.md 3.1/3.2)
  // ==========================================================
  describe('save — new entity (INSERT path, crearSolicitud/crearBorradorRefill)', () => {
    it('checks existence first (SELECT id WHERE id = $1) before deciding whether to insert', async () => {
      const { db, calls } = buildSaveNewDb();
      const repo = new KyselyRefillRepository(db);

      await repo.save(activaFixture());

      expect(calls['selectFrom']).toEqual([['refill_requests']]);
      expect(calls['existsWhere']).toEqual([['id', '=', 'request-1']]);
    });

    it('writes estado EXPLICITLY on the insert for a brand-new active request (design.md D-G.4 — never relies on the DB default)', async () => {
      const { db, requestInsertChain } = buildSaveNewDb();
      const repo = new KyselyRefillRepository(db);

      await repo.save(activaFixture({ estado: 'abierta' }));

      expect(requestInsertChain.values).toHaveBeenCalledTimes(1);
      const [insertedValues] = requestInsertChain.values.mock.calls[0] as [Record<string, unknown>];
      expect(insertedValues).toHaveProperty('estado', 'abierta');
      expect(Object.keys(insertedValues)).toContain('estado');
    });

    it('writes estado EXPLICITLY on the insert for a brand-new borrador request (D-G.4 — the fail-open default is neutralized here)', async () => {
      const { db, requestInsertChain } = buildSaveNewDb();
      const repo = new KyselyRefillRepository(db);

      await repo.save(borradorFixture());

      const [insertedValues] = requestInsertChain.values.mock.calls[0] as [Record<string, unknown>];
      expect(insertedValues).toHaveProperty('estado', 'borrador');
    });

    it('bulk-inserts ALL items in ONE multi-row statement, never N roundtrips', async () => {
      const { db, itemsInsertChain } = buildSaveNewDb();
      const repo = new KyselyRefillRepository(db);

      await repo.save(activaFixture());

      expect(itemsInsertChain.values).toHaveBeenCalledTimes(1);
      expect(itemsInsertChain.execute).toHaveBeenCalledTimes(1);
      const [itemRows] = itemsInsertChain.values.mock.calls[0] as [unknown[]];
      expect(itemRows).toHaveLength(2);
    });

    it('formats precioReferencia into the numeric-column string shape on insert', async () => {
      const { db, itemsInsertChain } = buildSaveNewDb();
      const repo = new KyselyRefillRepository(db);

      await repo.save(activaFixture());

      const [itemRows] = itemsInsertChain.values.mock.calls[0] as [Record<string, unknown>[]];
      expect(itemRows[0]).toMatchObject({ id: 'item-1', precio_referencia: '1990.00' });
    });

    it('writes NULL (never 0/empty string) for a borrador item missing categoria/precioReferencia', async () => {
      const { db, itemsInsertChain } = buildSaveNewDb();
      const repo = new KyselyRefillRepository(db);

      await repo.save(borradorFixture());

      const [itemRows] = itemsInsertChain.values.mock.calls[0] as [Record<string, unknown>[]];
      expect(itemRows[0]).toMatchObject({ categoria: null, precio_referencia: null });
    });

    it('never calls updateTable on the insert path', async () => {
      const { db } = buildSaveNewDb();
      const updateTable = jest.fn();
      (db as unknown as { updateTable: jest.Mock }).updateTable = updateTable;
      const repo = new KyselyRefillRepository(db);

      await repo.save(activaFixture());

      expect(updateTable).not.toHaveBeenCalled();
    });

    it('propagates tx to the existence check and both inserts (repo-wide convention)', async () => {
      const { db: unusedDb } = buildSaveNewDb();
      const { db: txDb, requestInsertChain, itemsInsertChain } = buildSaveNewDb();
      const repo = new KyselyRefillRepository(unusedDb);
      const tx = txDb as unknown as TransactionContext;

      await repo.save(activaFixture(), tx);

      expect(requestInsertChain.execute).toHaveBeenCalledTimes(1);
      expect(itemsInsertChain.execute).toHaveBeenCalledTimes(1);
    });
  });

  // ==========================================================
  // save() — EXISTING entity, borrador -> activa (tasks.md 3.3/3.4)
  // ==========================================================
  describe('save — existing entity (UPDATE path, completarBorrador transition)', () => {
    it('issues exactly ONE update on refill_requests', async () => {
      const { db, calls } = buildSaveUpdateDb();
      const repo = new KyselyRefillRepository(db);

      await repo.save(activaFixture({ id: 'request-borrador-1' }));

      expect(calls['updateTable']!.filter(([table]) => table === 'refill_requests')).toHaveLength(
        1,
      );
      expect(calls['requestUpdateWhere']).toEqual([['id', '=', 'request-borrador-1']]);
    });

    it('updates every item IN PLACE, keyed by its own id — one UPDATE per item, never a DELETE', async () => {
      const { db, itemUpdateWhereCalls, deleteFrom } = buildSaveUpdateDb();
      const repo = new KyselyRefillRepository(db);
      const entity = activaFixture({ id: 'request-borrador-1' });

      await repo.save(entity);

      expect(itemUpdateWhereCalls).toEqual([
        ['id', '=', 'item-1'],
        ['id', '=', 'item-2'],
      ]);
      expect(deleteFrom).not.toHaveBeenCalled();
    });

    it('never calls insertInto on the update path — nothing is re-inserted', async () => {
      const { db, insertInto } = buildSaveUpdateDb();
      const repo = new KyselyRefillRepository(db);

      await repo.save(activaFixture({ id: 'request-borrador-1' }));

      expect(insertInto).not.toHaveBeenCalled();
    });

    it('issues zero DELETE statements (criterio de éxito: "ningún DELETE físico introducido")', async () => {
      const { db, deleteFrom } = buildSaveUpdateDb();
      const repo = new KyselyRefillRepository(db);

      await repo.save(activaFixture({ id: 'request-borrador-1' }));

      expect(deleteFrom).not.toHaveBeenCalled();
    });

    it('writes estado EXPLICITLY on the update too (borrador -> abierta transition, D-G.4)', async () => {
      const { db, requestUpdateChain } = buildSaveUpdateDb();
      const repo = new KyselyRefillRepository(db);

      await repo.save(activaFixture({ id: 'request-borrador-1', estado: 'abierta' }));

      const [updateValues] = requestUpdateChain.set.mock.calls[0] as [Record<string, unknown>];
      expect(updateValues).toHaveProperty('estado', 'abierta');
    });

    it('propagates tx to the existence check, the request update, and every item update', async () => {
      const { db: unusedDb } = buildSaveUpdateDb();
      const { db: txDb, requestUpdateChain, itemUpdateSetCalls } = buildSaveUpdateDb();
      const repo = new KyselyRefillRepository(unusedDb);
      const tx = txDb as unknown as TransactionContext;

      await repo.save(activaFixture({ id: 'request-borrador-1' }), tx);

      expect(requestUpdateChain.execute).toHaveBeenCalledTimes(1);
      expect(itemUpdateSetCalls).toHaveLength(2);
    });
  });

  // ==========================================================
  // findById() — Number(null) === 0 round-trip (tasks.md 3.5/3.6,
  // design.md's highest mechanical-risk callout)
  // ==========================================================
  describe("findById — the Number(null) === 0 round-trip (design.md's highest mechanical-risk callout)", () => {
    it("maps a borrador's NULL categoria/precioReferencia/direccion/comuna to undefined — explicitly, NEVER 0, NEVER ''", async () => {
      const { db } = buildJoinSelectDb([borradorJoinRow()]);
      const repo = new KyselyRefillRepository(db);

      const result = await repo.findById('request-borrador-1');

      expect(result).not.toBeNull();
      expect(result!.estado).toBe('borrador');
      expect((result as RefillRequestBorrador).direccion).toBeUndefined();
      expect((result as RefillRequestBorrador).comuna).toBeUndefined();
      expect(result!.items[0]!.categoria).toBeUndefined();
      expect((result!.items[0] as { precioReferencia?: number }).precioReferencia).toBeUndefined();
      // The explicit negative: this is NOT the centinela D3 rejects.
      expect(result!.items[0]!.categoria).not.toBe('');
      expect((result!.items[0] as { precioReferencia?: number }).precioReferencia).not.toBe(0);
    });

    it("maps a complete row's precio_referencia string ('1990.00') to a number (1990), typeof 'number'", async () => {
      const { db } = buildJoinSelectDb([completeJoinRow()]);
      const repo = new KyselyRefillRepository(db);

      const result = await repo.findById('request-1');

      expect(result!.estado).toBe('abierta');
      const item = result!.items[0] as { precioReferencia: number; categoria: string };
      expect(item.precioReferencia).toBe(1990);
      expect(typeof item.precioReferencia).toBe('number');
      expect(item.categoria).toBe('alimento');
    });

    it('maps a complete request with populated direccion/comuna as plain strings (never coerced)', async () => {
      const { db } = buildJoinSelectDb([completeJoinRow()]);
      const repo = new KyselyRefillRepository(db);

      const result = await repo.findById('request-1');

      expect((result as RefillRequestActiva).direccion).toBe('Calle Falsa 123');
      expect((result as RefillRequestActiva).comuna).toBe('Providencia');
    });

    it('maps every item row belonging to the same request (multi-row join collapses into one entity)', async () => {
      const { db } = buildJoinSelectDb([
        completeJoinRow({ item_id: 'item-1' }),
        completeJoinRow({ item_id: 'item-2', nombre: 'Arena Gato', categoria: 'higiene' }),
      ]);
      const repo = new KyselyRefillRepository(db);

      const result = await repo.findById('request-1');

      expect(result!.items).toHaveLength(2);
    });

    it('returns null when no rows match', async () => {
      const { db } = buildJoinSelectDb([]);
      const repo = new KyselyRefillRepository(db);

      await expect(repo.findById('missing')).resolves.toBeNull();
    });

    it('queries with a single SELECT + JOIN against refill_items on refill_request_id', async () => {
      const { db, calls } = buildJoinSelectDb([completeJoinRow()]);
      const repo = new KyselyRefillRepository(db);

      await repo.findById('request-1');

      expect(calls['selectFrom']).toEqual([['refill_requests as r']]);
      expect(calls['innerJoin']).toEqual([['refill_items as i', 'i.refill_request_id', 'r.id']]);
      expect(calls['where']).toEqual([['r.id', '=', 'request-1']]);
    });

    it('propagates tx (repo-wide convention)', async () => {
      const { db: unusedDb } = buildJoinSelectDb([completeJoinRow()]);
      const { db: txDb, chain } = buildJoinSelectDb([completeJoinRow()]);
      const repo = new KyselyRefillRepository(unusedDb);
      const tx = txDb as unknown as TransactionContext;

      await repo.findById('request-1', tx);

      expect(chain.execute).toHaveBeenCalledTimes(1);
    });
  });

  // ==========================================================
  // findBorradorByConsumption() — D-D.3 dedup (tasks.md 3.7/3.8)
  // ==========================================================
  describe('findBorradorByConsumption — D-D.3 dedup', () => {
    it("filters explicitly on estado = 'borrador' in the SQL predicate, not just user_id/consumption_id", async () => {
      const { db, calls } = buildJoinSelectDb([borradorJoinRow()]);
      const repo = new KyselyRefillRepository(db);

      await repo.findBorradorByConsumption('user-1', 'consumption-1');

      expect(calls['where']).toEqual([
        ['r.user_id', '=', 'user-1'],
        ['r.consumption_id', '=', 'consumption-1'],
        ['r.estado', '=', 'borrador'],
      ]);
    });

    it('returns the open borrador when one exists for that (userId, consumptionId) pair', async () => {
      const { db } = buildJoinSelectDb([borradorJoinRow()]);
      const repo = new KyselyRefillRepository(db);

      const result = await repo.findBorradorByConsumption('user-1', 'consumption-1');

      expect(result).not.toBeNull();
      expect(result!.estado).toBe('borrador');
      expect(result!.consumptionId).toBe('consumption-1');
    });

    it('returns null when no rows match (none exists, or the only match already left borrador — enforced by the WHERE, not app code)', async () => {
      const { db } = buildJoinSelectDb([]);
      const repo = new KyselyRefillRepository(db);

      await expect(repo.findBorradorByConsumption('user-1', 'consumption-1')).resolves.toBeNull();
    });

    it('propagates tx (repo-wide convention)', async () => {
      const { db: unusedDb } = buildJoinSelectDb([borradorJoinRow()]);
      const { db: txDb, chain } = buildJoinSelectDb([borradorJoinRow()]);
      const repo = new KyselyRefillRepository(unusedDb);
      const tx = txDb as unknown as TransactionContext;

      await repo.findBorradorByConsumption('user-1', 'consumption-1', tx);

      expect(chain.execute).toHaveBeenCalledTimes(1);
    });
  });

  // ==========================================================
  // actualizarEstado() — narrow state-only write (tasks.md 3.9/3.10)
  // ==========================================================
  describe('actualizarEstado — narrow state-only write (D6/D-G.2)', () => {
    it('issues a single UPDATE refill_requests SET estado = $2 WHERE id = $1', async () => {
      const { db, calls } = buildActualizarEstadoDb();
      const repo = new KyselyRefillRepository(db);

      await repo.actualizarEstado('request-1', 'ofertada');

      expect(calls['updateTable']).toEqual([['refill_requests']]);
      expect(calls['set']).toEqual([[{ estado: 'ofertada' }]]);
      expect(calls['where']).toEqual([['id', '=', 'request-1']]);
    });

    it('NEVER touches refill_items — no select, no insert, no join; updateTable called exactly once total', async () => {
      const { db, calls, selectFrom, insertInto } = buildActualizarEstadoDb();
      const repo = new KyselyRefillRepository(db);

      await repo.actualizarEstado('request-1', 'confirmada');

      expect(calls['updateTable']).toHaveLength(1);
      expect(selectFrom).not.toHaveBeenCalled();
      expect(insertInto).not.toHaveBeenCalled();
    });

    it('propagates tx (repo-wide convention)', async () => {
      const { db: unusedDb } = buildActualizarEstadoDb();
      const { db: txDb, chain } = buildActualizarEstadoDb();
      const repo = new KyselyRefillRepository(unusedDb);
      const tx = txDb as unknown as TransactionContext;

      await repo.actualizarEstado('request-1', 'ofertada', tx);

      expect(chain.execute).toHaveBeenCalledTimes(1);
    });
  });

  // ==========================================================
  // toRefillItem — the invariant guard the discriminated union can't
  // enforce at compile time (a NULL reaching a non-'borrador' row is a
  // write-time bug this mapper refuses to paper over).
  // ==========================================================
  describe('toRefillItem — refuses to silently coerce a NULL into a centinela for a non-borrador row', () => {
    it('throws rather than returning precioReferencia: 0 / categoria: "" when the row is unexpectedly incomplete', () => {
      expect(() => toRefillItem(borradorJoinRow() as never)).toThrow(/NULL/);
    });
  });
});
