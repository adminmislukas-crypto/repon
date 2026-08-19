import type { Kysely, Selectable } from 'kysely';
import type { Pet } from '@repon/types';
import type { DB, PetsTable } from '../../../../shared/database/schema';
import { KyselyPetRepository } from './kysely-pet.repository';

// First implementer of `PetRepository` (design.md D-H.1) — new file, first
// caller. `peso_kg` is `numeric`, so node-postgres returns it as `string`
// (design.md's "detalle mecánico de mayor riesgo del cambio" — same gotcha
// `kysely-consumption.repository.spec.ts` already asserts for
// `dosis_por_toma`/`stock_actual`, and `kysely-catalog.repository.spec.ts`
// for `precio_base`/`precio_maximo`). Mirrors `kysely-company.repository.ts`'s
// upsert-on-id shape (`onConflict((oc) => oc.column('id').doUpdateSet(...))`)
// — `Pet` has no bifurcated conflict target the way `ProviderCatalogItem`
// does, so `save()` is the simplest of the 3 upsert precedents in this repo.

function buildRow(overrides: Partial<Selectable<PetsTable>> = {}): Selectable<PetsTable> {
  return {
    id: 'pet-1',
    user_id: 'user-a',
    nombre: 'Firulais',
    especie: 'perro',
    raza: 'Labrador',
    // node-postgres returns `numeric` as `string` (design.md's flagged gotcha).
    peso_kg: '25.50',
    created_at: '2026-01-01T00:00:00Z',
    updated_at: '2026-01-01T00:00:00Z',
    ...overrides,
  };
}

function buildSelectDb(rows: unknown[]) {
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

function buildListDb(rows: unknown[]) {
  const calls: Record<string, unknown[][]> = {};
  const record = (method: string, args: unknown[]) => {
    (calls[method] ??= []).push(args);
  };
  const chain: Record<string, jest.Mock> = {};
  chain.selectAll = jest.fn((...args: unknown[]) => {
    record('selectAll', args);
    return chain;
  });
  chain.where = jest.fn((...args: unknown[]) => {
    record('where', args);
    return chain;
  });
  chain.orderBy = jest.fn((...args: unknown[]) => {
    record('orderBy', args);
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

describe('KyselyPetRepository', () => {
  describe('save — insert-or-update on id (D-H.1)', () => {
    const pet: Pet = {
      id: 'pet-1',
      userId: 'user-a',
      nombre: 'Firulais',
      especie: 'perro',
      raza: 'Labrador',
      pesoKg: 25.5,
    };

    it('inserts with the id as the conflict target', async () => {
      const { db, calls, insertChain } = buildInsertDb();
      const repo = new KyselyPetRepository(db);

      await repo.save(pet);

      expect(calls['column']).toEqual([['id']]);
      expect(insertChain.values).toHaveBeenCalledWith(
        expect.objectContaining({ id: 'pet-1', user_id: 'user-a', nombre: 'Firulais' }),
      );
    });

    it('rounds pesoKg into the numeric-column string shape (design.md gotcha)', async () => {
      const { db, insertChain } = buildInsertDb();
      const repo = new KyselyPetRepository(db);

      await repo.save(pet);

      expect(insertChain.values).toHaveBeenCalledWith(
        expect.objectContaining({ peso_kg: '25.50' }),
      );
    });

    it('writes null for an absent pesoKg — never NaN/undefined on the wire', async () => {
      const { db, insertChain } = buildInsertDb();
      const repo = new KyselyPetRepository(db);

      await repo.save({ ...pet, raza: undefined, pesoKg: undefined });

      expect(insertChain.values).toHaveBeenCalledWith(
        expect.objectContaining({ raza: null, peso_kg: null }),
      );
    });

    it('DO UPDATE SET never touches user_id (an owner never changes via save())', async () => {
      const { db, calls } = buildInsertDb();
      const repo = new KyselyPetRepository(db);

      await repo.save(pet);

      const [update] = calls['doUpdateSet']![0] as [Record<string, unknown>];
      expect(update).not.toHaveProperty('user_id');
    });
  });

  describe('findById — the ownership check ConfigurarConsumoUseCase needs (D-H.3)', () => {
    it('maps a found row, converting peso_kg string -> number', async () => {
      const { db } = buildSelectDb([buildRow()]);
      const repo = new KyselyPetRepository(db);

      const result = await repo.findById('pet-1');

      expect(result).toEqual({
        id: 'pet-1',
        userId: 'user-a',
        nombre: 'Firulais',
        especie: 'perro',
        raza: 'Labrador',
        pesoKg: 25.5,
      });
      expect(typeof result?.pesoKg).toBe('number');
    });

    it('maps a null peso_kg to undefined, never NaN/0', async () => {
      const { db } = buildSelectDb([buildRow({ peso_kg: null, raza: null })]);
      const repo = new KyselyPetRepository(db);

      const result = await repo.findById('pet-1');

      expect(result?.pesoKg).toBeUndefined();
      expect(result?.raza).toBeUndefined();
    });

    it('queries by id', async () => {
      const { db, whereCalls } = buildSelectDb([buildRow()]);
      const repo = new KyselyPetRepository(db);

      await repo.findById('pet-1');

      expect(whereCalls).toEqual([['id', '=', 'pet-1']]);
    });

    it('returns null when no row matches — never throws (D-H.3: the use case decides 404, not the repository)', async () => {
      const { db } = buildSelectDb([]);
      const repo = new KyselyPetRepository(db);

      await expect(repo.findById('missing')).resolves.toBeNull();
    });
  });

  describe('findByUserId — the actor-scoped list GET /consumo/mis-mascotas needs (usuario-mobile-consumo D-3/D-4)', () => {
    it('scopes with user_id = $1 inside the SQL, ordered by created_at', async () => {
      const { db, calls } = buildListDb([buildRow()]);
      const repo = new KyselyPetRepository(db);

      await repo.findByUserId('user-a');

      expect(calls['selectFrom']).toEqual([['pets']]);
      expect(calls['where']).toEqual([['user_id', '=', 'user-a']]);
      expect(calls['orderBy']).toEqual([['created_at', 'asc']]);
    });

    it('maps every row through mapPetRow, converting peso_kg string -> number', async () => {
      const { db } = buildListDb([buildRow(), buildRow({ id: 'pet-2', peso_kg: null })]);
      const repo = new KyselyPetRepository(db);

      const result = await repo.findByUserId('user-a');

      expect(result).toHaveLength(2);
      expect(result[0]!.pesoKg).toBe(25.5);
      expect(result[1]!.pesoKg).toBeUndefined();
    });

    it('returns an empty array for a user with no pets — never throws', async () => {
      const { db } = buildListDb([]);
      const repo = new KyselyPetRepository(db);

      await expect(repo.findByUserId('user-with-nothing')).resolves.toEqual([]);
    });
  });
});
