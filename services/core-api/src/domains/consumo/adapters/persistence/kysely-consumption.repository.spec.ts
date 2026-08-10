import type { Kysely, Selectable } from 'kysely';
import type { UserConsumption } from '@repon/types';
import type { DB, UserConsumptionTable } from '../../../../shared/database/schema';
import { KyselyConsumptionRepository } from './kysely-consumption.repository';

// design.md's "detalle mecánico de mayor riesgo del cambio": `dosis_por_toma`
// and `stock_actual` are `numeric` columns — node-postgres returns them as
// `string`, never `number` (same gotcha `catalogo`'s D-C already documented
// for `precio_base`/`precio_maximo`). `stock_bajo_notificado_at` is also
// `numeric`-adjacent risk territory (a `timestamptz`, string either way, but
// MUST stay a string | null, never coerced to a `Date` or a `number`) — this
// spec asserts all three conversions explicitly so a missing `Number(...)`
// call fails loudly here instead of corrupting `diasRestantes` in silence.
//
// `findById` landed in PR 2b.2; `save` lands in this PR (3.7/3.8, D-H) —
// the rest of `ConsumptionRepository` (`findDueForCheck`,
// `intentarMarcarStockBajo`, `limpiarMarcaStockBajo`, `descontarStock`)
// extend this SAME file incrementally in PR4/6a, mirroring `catalogo`'s
// `KyselyCatalogRepository` convention (one file per domain repository, not
// one file per method).

function buildRow(
  overrides: Partial<Selectable<UserConsumptionTable>> = {},
): Selectable<UserConsumptionTable> {
  return {
    id: 'consumption-1',
    user_id: 'user-a',
    owner_type: 'self',
    pet_id: null,
    kind: 'medicamento',
    nombre: 'Losartan',
    // node-postgres returns `numeric` as `string` (design.md's flagged gotcha).
    dosis_por_toma: '2.50',
    unidad: 'mg',
    frecuencia_dias: 1,
    horarios: ['08:00', '20:00'],
    stock_actual: '10.00',
    auto_crear_refill: false,
    stock_bajo_notificado_at: null,
    created_at: '2026-01-01T00:00:00Z',
    updated_at: '2026-01-01T00:00:00Z',
    ...overrides,
  };
}

function buildDb(rows: unknown[]) {
  const whereCalls: unknown[][] = [];
  const chain: Record<string, jest.Mock> = {};
  chain.selectAll = jest.fn(() => chain);
  chain.where = jest.fn((...args: unknown[]) => {
    whereCalls.push(args);
    return chain;
  });
  chain.executeTakeFirst = jest.fn(async () => rows[0]);
  const selectFrom = jest.fn(() => chain);
  const db = { selectFrom } as unknown as Kysely<DB>;
  return { db, selectFrom, chain, whereCalls };
}

// design.md D-H: `save()` upserts on `id` — mirrors `KyselyPetRepository`'s
// and `KyselyCompanyRepository`'s single-column conflict-target shape (no
// bifurcation the way `KyselyCatalogRepository.save()` needs).
function buildInsertDb() {
  const calls: Record<string, unknown[][]> = {};
  const record = (method: string, args: unknown[]) => {
    (calls[method] ??= []).push(args);
  };
  const onConflictBuilder: Record<string, jest.Mock> = {};
  onConflictBuilder.column = jest.fn((...args: unknown[]) => {
    record('column', args);
    return onConflictBuilder;
  });
  onConflictBuilder.doUpdateSet = jest.fn((...args: unknown[]) => {
    record('doUpdateSet', args);
    return onConflictBuilder;
  });

  const insertChain: Record<string, jest.Mock> = {};
  insertChain.values = jest.fn((...args: unknown[]) => {
    record('values', args);
    return insertChain;
  });
  insertChain.onConflict = jest.fn((build: (oc: typeof onConflictBuilder) => unknown) => {
    build(onConflictBuilder);
    return insertChain;
  });
  insertChain.execute = jest.fn(async () => undefined);
  const insertInto = jest.fn(() => insertChain);
  const db = { insertInto } as unknown as Kysely<DB>;
  return { db, calls, insertChain };
}

describe('KyselyConsumptionRepository', () => {
  describe('findById', () => {
    it('maps a found row, converting dosis_por_toma/stock_actual string -> number (design.md numeric gotcha)', async () => {
      const { db } = buildDb([buildRow()]);
      const repo = new KyselyConsumptionRepository(db);

      const result = await repo.findById('consumption-1');

      expect(result).toEqual({
        id: 'consumption-1',
        userId: 'user-a',
        ownerType: 'self',
        petId: undefined,
        kind: 'medicamento',
        nombre: 'Losartan',
        dosisPorToma: 2.5,
        unidad: 'mg',
        frecuenciaDias: 1,
        horarios: ['08:00', '20:00'],
        stockActual: 10,
        autoCrearRefill: false,
      });
      expect(typeof result?.dosisPorToma).toBe('number');
      expect(typeof result?.stockActual).toBe('number');
    });

    it('maps petId through when ownerType is pet (never coerced/dropped)', async () => {
      const { db } = buildDb([buildRow({ owner_type: 'pet', pet_id: 'pet-1' })]);
      const repo = new KyselyConsumptionRepository(db);

      const result = await repo.findById('consumption-1');

      expect(result?.ownerType).toBe('pet');
      expect(result?.petId).toBe('pet-1');
    });

    it('queries by id', async () => {
      const { db, whereCalls } = buildDb([buildRow()]);
      const repo = new KyselyConsumptionRepository(db);

      await repo.findById('consumption-1');

      expect(whereCalls).toEqual([['id', '=', 'consumption-1']]);
    });

    it('returns null when no row matches — never throws (D7: the use case decides 404, not the repository)', async () => {
      const { db } = buildDb([]);
      const repo = new KyselyConsumptionRepository(db);

      await expect(repo.findById('missing')).resolves.toBeNull();
    });
  });

  describe("save — configurarConsumo's only write path today (D-H, upsert on id)", () => {
    const consumption: UserConsumption = {
      id: 'consumption-1',
      userId: 'user-a',
      ownerType: 'pet',
      petId: 'pet-1',
      kind: 'medicamento',
      nombre: 'Losartan',
      dosisPorToma: 2.5,
      unidad: 'mg',
      frecuenciaDias: 1,
      horarios: ['08:00', '20:00'],
      stockActual: 10,
      autoCrearRefill: false,
    };

    it('inserts with id as the conflict target', async () => {
      const { db, calls, insertChain } = buildInsertDb();
      const repo = new KyselyConsumptionRepository(db);

      await repo.save(consumption);

      expect(calls['column']).toEqual([['id']]);
      expect(insertChain.values).toHaveBeenCalledWith(
        expect.objectContaining({ id: 'consumption-1', user_id: 'user-a', pet_id: 'pet-1' }),
      );
    });

    it('formats dosisPorToma/stockActual into the numeric-column string shape (design.md gotcha)', async () => {
      const { db, insertChain } = buildInsertDb();
      const repo = new KyselyConsumptionRepository(db);

      await repo.save(consumption);

      expect(insertChain.values).toHaveBeenCalledWith(
        expect.objectContaining({ dosis_por_toma: '2.50', stock_actual: '10.00' }),
      );
    });

    it('writes null for an absent petId/unidad — never undefined on the wire', async () => {
      const { db, insertChain } = buildInsertDb();
      const repo = new KyselyConsumptionRepository(db);

      await repo.save({ ...consumption, ownerType: 'self', petId: undefined, unidad: undefined });

      expect(insertChain.values).toHaveBeenCalledWith(
        expect.objectContaining({ pet_id: null, unidad: null }),
      );
    });

    it('propagates tx to the insert (D6/D4 repo-wide convention) — `executor(tx)` runs the query against the tx handle, not `this.db`', async () => {
      const { db: unusedDb } = buildInsertDb();
      const { db: txDb, insertChain: txInsertChain } = buildInsertDb();
      const repo = new KyselyConsumptionRepository(unusedDb);
      const tx =
        txDb as unknown as import('../../../../shared/database/transaction').TransactionContext;

      await repo.save(consumption, tx);

      expect(txInsertChain.execute).toHaveBeenCalledTimes(1);
    });

    it('DO UPDATE SET never touches user_id (D7: the owner never changes via save())', async () => {
      const { db, calls } = buildInsertDb();
      const repo = new KyselyConsumptionRepository(db);

      await repo.save(consumption);

      const [update] = calls['doUpdateSet']![0] as [Record<string, unknown>];
      expect(update).not.toHaveProperty('user_id');
    });

    it('DO UPDATE SET never touches stock_bajo_notificado_at (D-A: only the CAS methods write that column)', async () => {
      const { db, calls } = buildInsertDb();
      const repo = new KyselyConsumptionRepository(db);

      await repo.save(consumption);

      const [update] = calls['doUpdateSet']![0] as [Record<string, unknown>];
      expect(update).not.toHaveProperty('stock_bajo_notificado_at');
    });
  });

  // design.md D-H.2: `UPDATE ... SET stock_actual = greatest(stock_actual -
  // $2, 0) ... RETURNING stock_actual` — ONE statement, never a prior
  // SELECT. The clamp-at-0 must live in the SQL itself (Postgres's
  // `greatest()`), not in application code — that is the ONLY thing that
  // keeps this immune to a lost update under two concurrent doses (a
  // read-then-`Math.max(0, ...)`-then-write would not be). `.toOperationNode()`
  // is public `RawBuilder` API (kysely's own docs use it to inspect a raw
  // expression's AST without a live DB) — used here, not internals, to
  // assert the exact SQL shape without needing a real Postgres connection.
  describe('descontarStock — atomic clamp-at-0 decrement (design.md D-H.2)', () => {
    function buildUpdateDb(row: { stock_actual: string }) {
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
      chain.executeTakeFirstOrThrow = jest.fn(async () => row);
      const updateTable = jest.fn((...args: unknown[]) => {
        record('updateTable', args);
        return chain;
      });
      const selectFrom = jest.fn();
      const db = { updateTable, selectFrom } as unknown as Kysely<DB>;
      return { db, calls, chain, selectFrom };
    }

    it('issues a single UPDATE targeting user_consumption by id, never a prior SELECT (atomic, not read-then-write)', async () => {
      const { db, calls, selectFrom } = buildUpdateDb({ stock_actual: '2.50' });
      const repo = new KyselyConsumptionRepository(db);

      await repo.descontarStock('consumption-1', 3);

      expect(calls['updateTable']).toEqual([['user_consumption']]);
      expect(calls['where']).toEqual([['id', '=', 'consumption-1']]);
      expect(calls['returning']).toEqual([['stock_actual']]);
      expect(selectFrom).not.toHaveBeenCalled();
    });

    it('SETs stock_actual to a raw SQL expression, never a plain JS-computed value — the clamp must live in the SQL', async () => {
      const { db, calls } = buildUpdateDb({ stock_actual: '0.00' });
      const repo = new KyselyConsumptionRepository(db);

      await repo.descontarStock('consumption-1', 3);

      const [setArg] = calls['set']![0] as [Record<string, unknown>];
      const raw = setArg['stock_actual'] as {
        isRawBuilder: boolean;
        toOperationNode(): {
          sqlFragments: readonly string[];
          parameters: readonly { value: unknown }[];
        };
      };
      expect(raw.isRawBuilder).toBe(true);
      // `greatest(stock_actual - $1, 0)` — the exact shape the port's doc
      // comment pins (D-H.2): one parameter (the amount to subtract),
      // clamped at 0 by Postgres's own greatest(), never divided/read.
      const node = raw.toOperationNode();
      expect(node.sqlFragments.join('')).toBe('greatest(stock_actual - , 0)');
      expect(node.parameters).toHaveLength(1);
      expect(node.parameters[0]!.value).toBe('3.00');
    });

    it('formats cantidad into the numeric-column string shape (design.md gotcha), even for a whole number', async () => {
      const { db, calls } = buildUpdateDb({ stock_actual: '1.00' });
      const repo = new KyselyConsumptionRepository(db);

      await repo.descontarStock('consumption-1', 1);

      const [setArg] = calls['set']![0] as [Record<string, unknown>];
      const raw = setArg['stock_actual'] as {
        toOperationNode(): { parameters: readonly { value: unknown }[] };
      };
      expect(raw.toOperationNode().parameters[0]!.value).toBe('1.00');
    });

    it('converts the RETURNING stock_actual string back to a number (design.md numeric gotcha)', async () => {
      const { db } = buildUpdateDb({ stock_actual: '0.00' });
      const repo = new KyselyConsumptionRepository(db);

      const result = await repo.descontarStock('consumption-1', 5);

      expect(result).toBe(0);
      expect(typeof result).toBe('number');
    });

    it('propagates tx to the update (D6/repo-wide convention) — runs against the tx handle, not this.db', async () => {
      const { db: unusedDb } = buildUpdateDb({ stock_actual: '1.00' });
      const { db: txDb, chain: txChain } = buildUpdateDb({ stock_actual: '1.00' });
      const repo = new KyselyConsumptionRepository(unusedDb);
      const tx =
        txDb as unknown as import('../../../../shared/database/transaction').TransactionContext;

      await repo.descontarStock('consumption-1', 2, tx);

      expect(txChain.executeTakeFirstOrThrow).toHaveBeenCalledTimes(1);
    });
  });
});
