import { MascotaInvalidaError } from './consumo.errors';
import { crear } from './pet.entity';

const USER_ID = '11111111-1111-1111-1111-111111111111';
const PET_ID = '22222222-2222-2222-2222-222222222222';

function nuevaMascota(
  overrides: Partial<Parameters<typeof crear>[0]> = {},
): Parameters<typeof crear>[0] {
  return {
    id: PET_ID,
    userId: USER_ID,
    nombre: 'Firulais',
    especie: 'perro',
    ...overrides,
  };
}

// core-api-consumo spec / design.md Phase 2a (tasks.md 2a.1): `crear()`
// rejects an invalid `nombre`/`especie` with `MascotaInvalidaError`.
describe('crear', () => {
  it('builds a Pet carrying the given id, userId and the caller-supplied fields', () => {
    const pet = crear(nuevaMascota({ raza: 'Labrador', pesoKg: 12 }));

    expect(pet).toEqual({
      id: PET_ID,
      userId: USER_ID,
      nombre: 'Firulais',
      especie: 'perro',
      raza: 'Labrador',
      pesoKg: 12,
    });
  });

  it('builds a Pet without raza/pesoKg when they are omitted (both optional)', () => {
    const pet = crear(nuevaMascota());

    expect(pet.raza).toBeUndefined();
    expect(pet.pesoKg).toBeUndefined();
  });

  it('rejects an empty nombre', () => {
    expect(() => crear(nuevaMascota({ nombre: '' }))).toThrow(MascotaInvalidaError);
  });

  it('rejects a whitespace-only nombre', () => {
    expect(() => crear(nuevaMascota({ nombre: '   ' }))).toThrow(MascotaInvalidaError);
  });

  it('rejects an empty especie', () => {
    expect(() => crear(nuevaMascota({ especie: '' }))).toThrow(MascotaInvalidaError);
  });

  it('rejects a whitespace-only especie', () => {
    expect(() => crear(nuevaMascota({ especie: '  ' }))).toThrow(MascotaInvalidaError);
  });
});
