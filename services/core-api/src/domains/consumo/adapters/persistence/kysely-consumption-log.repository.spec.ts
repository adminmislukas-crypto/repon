import type { Kysely } from 'kysely';
import type { ConsumptionLog } from '@repon/types';
import type { DB } from '../../../../shared/database/schema';
import { KyselyConsumptionLogRepository } from './kysely-consumption-log.repository';

// First implementer of `ConsumptionLogRepository` (design.md D-H.2, PR4).
// `append()` is a pure insert, never an upsert — a dose log is append-only
// health data (design.md D-H.2: "el log es el registro de salud y debe
// reflejar la realidad"). `cantidad` is `numeric` -> `string` on the wire —
// same gotcha `kysely-consumption.repository.ts`/`kysely-pet.repository.ts`
// already document for `dosis_por_toma`/`stock_actual`/`peso_kg`.

function buildInsertDb() {
  const calls: Record<string, unknown[][]> = {};
  const record = (method: string, args: unknown[]) => {
    (calls[method] ??= []).push(args);
  };
  const insertChain: Record<string, jest.Mock> = {};
  insertChain.values = jest.fn((...args: unknown[]) => {
    record('values', args);
    return insertChain;
  });
  insertChain.execute = jest.fn(async () => undefined);
  const insertInto = jest.fn((...args: unknown[]) => {
    record('insertInto', args);
    return insertChain;
  });
  const db = { insertInto } as unknown as Kysely<DB>;
  return { db, calls, insertChain };
}

describe('KyselyConsumptionLogRepository', () => {
  describe("append — MarcarDosisTomadaUseCase's only write path (D-H.2)", () => {
    const log: ConsumptionLog = {
      id: 'log-1',
      consumptionId: 'consumption-1',
      tomadoAt: '2026-08-10T12:00:00.000Z',
      cantidad: 2.5,
    };

    it('inserts into consumption_logs with the given id (never a DB default, D-H.1 repo-wide precedent)', async () => {
      const { db, calls, insertChain } = buildInsertDb();
      const repo = new KyselyConsumptionLogRepository(db);

      await repo.append(log);

      expect(calls['insertInto']).toEqual([['consumption_logs']]);
      expect(insertChain.values).toHaveBeenCalledWith(
        expect.objectContaining({ id: 'log-1', consumption_id: 'consumption-1' }),
      );
    });

    it('formats cantidad into the numeric-column string shape (design.md gotcha)', async () => {
      const { db, insertChain } = buildInsertDb();
      const repo = new KyselyConsumptionLogRepository(db);

      await repo.append(log);

      expect(insertChain.values).toHaveBeenCalledWith(
        expect.objectContaining({ cantidad: '2.50' }),
      );
    });

    it('writes null cantidad when absent — never undefined on the wire', async () => {
      const { db, insertChain } = buildInsertDb();
      const repo = new KyselyConsumptionLogRepository(db);

      await repo.append({ ...log, cantidad: undefined });

      expect(insertChain.values).toHaveBeenCalledWith(expect.objectContaining({ cantidad: null }));
    });

    it('passes tomadoAt through verbatim (already ISO-8601 by the time it reaches this adapter)', async () => {
      const { db, insertChain } = buildInsertDb();
      const repo = new KyselyConsumptionLogRepository(db);

      await repo.append(log);

      expect(insertChain.values).toHaveBeenCalledWith(
        expect.objectContaining({ tomado_at: '2026-08-10T12:00:00.000Z' }),
      );
    });

    it('propagates tx to the insert (D6/repo-wide convention) — runs against the tx handle, not this.db', async () => {
      const { db: unusedDb } = buildInsertDb();
      const { db: txDb, insertChain: txInsertChain } = buildInsertDb();
      const repo = new KyselyConsumptionLogRepository(unusedDb);
      const tx =
        txDb as unknown as import('../../../../shared/database/transaction').TransactionContext;

      await repo.append(log, tx);

      expect(txInsertChain.execute).toHaveBeenCalledTimes(1);
    });
  });

  describe('contarTomasPorDia — one grouped query for the 7-day adherence window (usuario-mobile-consumo D-3)', () => {
    function buildSelectDb(rows: unknown[]) {
      const calls: Record<string, unknown[][]> = {};
      const record = (method: string, args: unknown[]) => {
        (calls[method] ??= []).push(args);
      };
      const chain: Record<string, jest.Mock> = {};
      chain.select = jest.fn((build: (eb: unknown) => unknown[]) => {
        const eb = { fn: { countAll: () => ({ as: (alias: string) => `countAll as ${alias}` }) } };
        record('select', build(eb));
        return chain;
      });
      chain.where = jest.fn((...args: unknown[]) => {
        record('where', args);
        return chain;
      });
      chain.groupBy = jest.fn((...args: unknown[]) => {
        record('groupBy', args);
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

    const desde = new Date('2026-08-01T04:00:00.000Z');
    const hasta = new Date('2026-08-08T04:00:00.000Z');

    it('short-circuits to [] on an empty id array — never issues a query (never `in ()`)', async () => {
      const { db, calls } = buildSelectDb([]);
      const repo = new KyselyConsumptionLogRepository(db);

      const result = await repo.contarTomasPorDia([], desde, hasta, 'America/Santiago');

      expect(result).toEqual([]);
      expect(calls['selectFrom']).toBeUndefined();
    });

    it('scopes with consumption_id IN (...ids) and the desde/hasta window on plain UTC instants', async () => {
      const { db, calls } = buildSelectDb([]);
      const repo = new KyselyConsumptionLogRepository(db);

      await repo.contarTomasPorDia(['c-1', 'c-2'], desde, hasta, 'America/Santiago');

      expect(calls['selectFrom']).toEqual([['consumption_logs']]);
      expect(calls['where']).toEqual([
        ['consumption_id', 'in', ['c-1', 'c-2']],
        ['tomado_at', '>=', desde.toISOString()],
        ['tomado_at', '<', hasta.toISOString()],
      ]);
    });

    it('never wraps tomado_at in a timezone function inside a WHERE clause (would disable the index, D-3)', async () => {
      const { db, calls } = buildSelectDb([]);
      const repo = new KyselyConsumptionLogRepository(db);

      await repo.contarTomasPorDia(['c-1'], desde, hasta, 'America/Santiago');

      for (const [, , value] of calls['where']!) {
        expect(typeof value === 'string' || typeof value === 'object').toBeTruthy();
        expect(String(value)).not.toMatch(/at time zone/i);
      }
    });

    it('groups by consumption_id and the timezone-bucketed date — at time zone only here, never in WHERE', async () => {
      const { db, calls } = buildSelectDb([]);
      const repo = new KyselyConsumptionLogRepository(db);

      await repo.contarTomasPorDia(['c-1'], desde, hasta, 'America/Santiago');

      const groupByArg = calls['groupBy']![0]![0] as unknown[];
      expect(groupByArg[0]).toBe('consumption_id');
      // The second grouping key is the raw `sql` template result — inspect
      // its compiled operation node (RawBuilder has no readable toString()).
      const rawBuilder = groupByArg[1] as { toOperationNode(): { sqlFragments: string[] } };
      expect(rawBuilder.toOperationNode().sqlFragments.join('')).toMatch(/at time zone/i);
    });

    it('maps rows to ConteoDiarioLog, converting the count string -> number', async () => {
      const { db } = buildSelectDb([
        { consumption_id: 'c-1', fecha: '2026-08-05', tomadas: '3' },
        { consumption_id: 'c-2', fecha: '2026-08-06', tomadas: '0' },
      ]);
      const repo = new KyselyConsumptionLogRepository(db);

      const result = await repo.contarTomasPorDia(['c-1', 'c-2'], desde, hasta, 'America/Santiago');

      expect(result).toEqual([
        { consumptionId: 'c-1', fecha: '2026-08-05', tomadas: 3 },
        { consumptionId: 'c-2', fecha: '2026-08-06', tomadas: 0 },
      ]);
    });

    it('propagates tx (D6/repo-wide convention) — runs against the tx handle, not this.db', async () => {
      const { db: unusedDb } = buildSelectDb([]);
      const { db: txDb, chain: txChain } = buildSelectDb([]);
      const repo = new KyselyConsumptionLogRepository(unusedDb);
      const tx =
        txDb as unknown as import('../../../../shared/database/transaction').TransactionContext;

      await repo.contarTomasPorDia(['c-1'], desde, hasta, 'America/Santiago', tx);

      expect(txChain.execute).toHaveBeenCalledTimes(1);
    });
  });
});
