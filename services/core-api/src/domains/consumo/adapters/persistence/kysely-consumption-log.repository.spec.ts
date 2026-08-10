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
});
