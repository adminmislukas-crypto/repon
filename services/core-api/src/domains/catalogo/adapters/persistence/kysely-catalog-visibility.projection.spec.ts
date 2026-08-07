import type { Kysely } from 'kysely';
import type { DB } from '../../../../shared/database/schema';
import { KyselyCatalogVisibilityProjection } from './kysely-catalog-visibility.projection';

// design.md D-A: `ocultarEmpresa` upserts `oculto = true` (PK `company_id`,
// `ON CONFLICT (company_id) DO UPDATE SET oculto = true, motivo =
// excluded.motivo`); `mostrarEmpresa` is a plain `UPDATE ... SET oculto =
// false WHERE company_id = $1` — a 0-rows-affected update (never hidden)
// is success, not an error, per the port's own doc comment.
//
// Mocked Kysely query-builder chain — same convention as
// `kysely-catalog.repository.spec.ts`'s `buildInsertDb` helper: records
// which `OnConflictBuilder` method was invoked, with which arguments,
// independent of the real SQL text.

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
  return { db, calls, insertChain, insertInto };
}

function buildUpdateDb(numUpdatedRows = 1n) {
  const calls: Record<string, unknown[][]> = {};
  const record = (method: string, args: unknown[]) => {
    (calls[method] ??= []).push(args);
  };
  const updateChain: Record<string, jest.Mock> = {};
  updateChain.set = jest.fn((...args: unknown[]) => {
    record('set', args);
    return updateChain;
  });
  updateChain.where = jest.fn((...args: unknown[]) => {
    record('where', args);
    return updateChain;
  });
  updateChain.execute = jest.fn(async () => [{ numUpdatedRows }]);
  const updateTable = jest.fn(() => updateChain);
  const db = { updateTable } as unknown as Kysely<DB>;
  return { db, calls, updateChain, updateTable };
}

describe('KyselyCatalogVisibilityProjection', () => {
  describe('ocultarEmpresa', () => {
    it('upserts oculto=true and motivo, with company_id as the ON CONFLICT target', async () => {
      const { db, calls, insertChain, insertInto } = buildInsertDb();
      const projection = new KyselyCatalogVisibilityProjection(db);

      await projection.ocultarEmpresa('company-a', 'Pago vencido');

      expect(insertInto).toHaveBeenCalledWith('catalog_hidden_companies');
      expect(insertChain.values).toHaveBeenCalledWith({
        company_id: 'company-a',
        oculto: true,
        motivo: 'Pago vencido',
      });
      expect(calls['column']).toEqual([['company_id']]);
      expect(calls['doUpdateSet']).toEqual([[{ oculto: true, motivo: 'Pago vencido' }]]);
    });

    it('accepts a null motivo', async () => {
      const { db, insertChain } = buildInsertDb();
      const projection = new KyselyCatalogVisibilityProjection(db);

      await projection.ocultarEmpresa('company-a', null);

      expect(insertChain.values).toHaveBeenCalledWith({
        company_id: 'company-a',
        oculto: true,
        motivo: null,
      });
    });
  });

  describe('mostrarEmpresa', () => {
    it('updates oculto=false for the given company_id', async () => {
      const { db, calls, updateTable } = buildUpdateDb(1n);
      const projection = new KyselyCatalogVisibilityProjection(db);

      await projection.mostrarEmpresa('company-a');

      expect(updateTable).toHaveBeenCalledWith('catalog_hidden_companies');
      expect(calls['set']).toEqual([[{ oculto: false }]]);
      expect(calls['where']).toEqual([['company_id', '=', 'company-a']]);
    });

    it('resolves successfully even when 0 rows are affected (never hidden — a silent no-op, not an error)', async () => {
      const { db } = buildUpdateDb(0n);
      const projection = new KyselyCatalogVisibilityProjection(db);

      await expect(projection.mostrarEmpresa('company-never-hidden')).resolves.toBeUndefined();
    });
  });
});
