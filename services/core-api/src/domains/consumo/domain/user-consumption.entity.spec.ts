import { ConsumoInvalidoError } from './consumo.errors';
import { crear } from './user-consumption.entity';

const USER_ID = '11111111-1111-1111-1111-111111111111';
const CONSUMPTION_ID = '22222222-2222-2222-2222-222222222222';
const PET_ID = '33333333-3333-3333-3333-333333333333';

function nuevoConsumo(
  overrides: Partial<Parameters<typeof crear>[0]> = {},
): Parameters<typeof crear>[0] {
  return {
    id: CONSUMPTION_ID,
    userId: USER_ID,
    ownerType: 'self',
    kind: 'alimento',
    nombre: 'Alimento Premium',
    dosisPorToma: 1,
    frecuenciaDias: 1,
    horarios: ['08:00'],
    stockActual: 10,
    autoCrearRefill: false,
    ...overrides,
  };
}

// core-api-consumo spec / design.md Phase 2a (tasks.md 2a.3): `crear()`
// enforces 3 invariants — `petId ⟺ ownerType==='pet'`, `dosisPorToma > 0`,
// `horarios` non-empty — all violations throw `ConsumoInvalidoError`.
describe('crear', () => {
  it('builds a UserConsumption for ownerType "self" without a petId', () => {
    const uc = crear(nuevoConsumo());

    expect(uc).toEqual({
      id: CONSUMPTION_ID,
      userId: USER_ID,
      ownerType: 'self',
      petId: undefined,
      kind: 'alimento',
      nombre: 'Alimento Premium',
      dosisPorToma: 1,
      unidad: undefined,
      frecuenciaDias: 1,
      horarios: ['08:00'],
      stockActual: 10,
      autoCrearRefill: false,
    });
  });

  it('builds a UserConsumption for ownerType "pet" with a petId', () => {
    const uc = crear(nuevoConsumo({ ownerType: 'pet', petId: PET_ID }));

    expect(uc.ownerType).toBe('pet');
    expect(uc.petId).toBe(PET_ID);
  });

  it('rejects ownerType "pet" without a petId', () => {
    expect(() => crear(nuevoConsumo({ ownerType: 'pet' }))).toThrow(ConsumoInvalidoError);
  });

  it('rejects a petId present when ownerType is "self"', () => {
    expect(() => crear(nuevoConsumo({ ownerType: 'self', petId: PET_ID }))).toThrow(
      ConsumoInvalidoError,
    );
  });

  it('rejects dosisPorToma === 0', () => {
    expect(() => crear(nuevoConsumo({ dosisPorToma: 0 }))).toThrow(ConsumoInvalidoError);
  });

  it('rejects a negative dosisPorToma', () => {
    expect(() => crear(nuevoConsumo({ dosisPorToma: -1 }))).toThrow(ConsumoInvalidoError);
  });

  it('rejects an empty horarios array', () => {
    expect(() => crear(nuevoConsumo({ horarios: [] }))).toThrow(ConsumoInvalidoError);
  });
});
