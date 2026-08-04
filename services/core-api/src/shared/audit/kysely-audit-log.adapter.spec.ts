import type { Kysely, Transaction } from 'kysely';
import type { DB } from '../database/schema';
import type { TransactionContext } from '../database/transaction';
import { KyselyAuditLogAdapter } from './kysely-audit-log.adapter';

// shared-audit-log spec, "record() participates in the caller's
// transaction" — the property under test is which executor
// (`this.db` vs. the unwrapped `tx`) actually receives `insertInto`.

function buildEntry() {
  return {
    actorProfileId: '00000000-0000-0000-0000-000000000001',
    accion: 'aprobar_empresa',
    entityType: 'company',
    entityId: '00000000-0000-0000-0000-000000000002',
    cambios: { status: { antes: 'pendiente', despues: 'activo' } },
  };
}

function mockExecutor() {
  const execute = jest.fn().mockResolvedValue(undefined);
  const values = jest.fn().mockReturnValue({ execute });
  const insertInto = jest.fn().mockReturnValue({ values });
  return { insertInto, values, execute };
}

describe('KyselyAuditLogAdapter', () => {
  it('writes through the shared db instance when no tx is given', async () => {
    const dbExecutor = mockExecutor();
    const db = { insertInto: dbExecutor.insertInto } as unknown as Kysely<DB>;
    const adapter = new KyselyAuditLogAdapter(db);

    await adapter.record(buildEntry());

    expect(dbExecutor.insertInto).toHaveBeenCalledWith('audit_log');
    expect(dbExecutor.values).toHaveBeenCalledWith(
      expect.objectContaining({
        actor_profile_id: '00000000-0000-0000-0000-000000000001',
        accion: 'aprobar_empresa',
        entity_type: 'company',
        entity_id: '00000000-0000-0000-0000-000000000002',
        cambios: { status: { antes: 'pendiente', despues: 'activo' } },
        motivo: null,
      }),
    );
  });

  it('writes through the given tx instead of the shared db instance', async () => {
    const dbExecutor = mockExecutor();
    const txExecutor = mockExecutor();
    const db = { insertInto: dbExecutor.insertInto } as unknown as Kysely<DB>;
    const trx = { insertInto: txExecutor.insertInto } as unknown as Transaction<DB>;
    const adapter = new KyselyAuditLogAdapter(db);

    await adapter.record(buildEntry(), trx as unknown as TransactionContext);

    expect(txExecutor.insertInto).toHaveBeenCalledWith('audit_log');
    expect(dbExecutor.insertInto).not.toHaveBeenCalled();
  });

  it('passes a given motivo through unchanged', async () => {
    const dbExecutor = mockExecutor();
    const db = { insertInto: dbExecutor.insertInto } as unknown as Kysely<DB>;
    const adapter = new KyselyAuditLogAdapter(db);

    await adapter.record({ ...buildEntry(), motivo: 'aprobación manual' });

    expect(dbExecutor.values).toHaveBeenCalledWith(
      expect.objectContaining({ motivo: 'aprobación manual' }),
    );
  });
});
