import type { Kysely, Selectable } from 'kysely';
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
// Only `findById` lands in this PR (2b.2) — the rest of `ConsumptionRepository`
// (`findDueForCheck`, `intentarMarcarStockBajo`, `limpiarMarcaStockBajo`,
// `descontarStock`, `save`) extend this SAME file incrementally in PR3/4/6a,
// mirroring `catalogo`'s `KyselyCatalogRepository` convention (one file per
// domain repository, not one file per method).

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
});
