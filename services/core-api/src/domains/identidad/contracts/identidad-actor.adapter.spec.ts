import type { Kysely } from 'kysely';
import type { DB } from '../../../shared/database/schema';
import { IdentidadActorAdapter } from './identidad-actor.adapter';

// core-api-auth-guard spec, "Actor resolution is a single query": asserts
// `selectFrom`/`executeTakeFirst` are each invoked exactly once (no
// per-field round-trip) with a mocked Kysely chain — the real JOIN's SQL
// correctness is proven separately against a live DB
// (test/identidad-actor.integration-spec.ts).
function buildDb(row: unknown) {
  const executeTakeFirst = jest.fn().mockResolvedValue(row);
  const where = jest.fn().mockReturnValue({ executeTakeFirst });
  const select = jest.fn().mockReturnValue({ where });
  const leftJoin2 = jest.fn().mockReturnValue({ select });
  const leftJoin1 = jest.fn().mockReturnValue({ leftJoin: leftJoin2 });
  const selectFrom = jest.fn().mockReturnValue({ leftJoin: leftJoin1 });
  return {
    db: { selectFrom } as unknown as Kysely<DB>,
    selectFrom,
    executeTakeFirst,
  };
}

describe('IdentidadActorAdapter', () => {
  it('resolves an actor with exactly one query', async () => {
    const { db, selectFrom, executeTakeFirst } = buildDb({
      profileId: 'p1',
      role: 'admin',
      status: 'activo',
      companyId: null,
      companyStatus: null,
      adminRole: 'super_admin',
    });
    const adapter = new IdentidadActorAdapter(db);

    const actor = await adapter.findActorById('p1');

    expect(selectFrom).toHaveBeenCalledTimes(1);
    expect(selectFrom).toHaveBeenCalledWith('profiles');
    expect(executeTakeFirst).toHaveBeenCalledTimes(1);
    expect(actor).toEqual({
      profileId: 'p1',
      role: 'admin',
      status: 'activo',
      companyId: null,
      companyStatus: null,
      adminRole: 'super_admin',
    });
  });

  it('returns null when no profile row matches', async () => {
    const { db } = buildDb(undefined);
    const adapter = new IdentidadActorAdapter(db);

    await expect(adapter.findActorById('missing')).resolves.toBeNull();
  });
});
