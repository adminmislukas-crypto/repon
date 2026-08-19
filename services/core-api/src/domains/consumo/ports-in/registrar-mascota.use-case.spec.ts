import type { Pet } from '@repon/types';
import type { PetRepository } from '../ports-out/pet-repository.port';
import { RegistrarMascotaUseCase } from './registrar-mascota.use-case';

// core-api-consumo spec: "registrarMascota and configurarConsumo derive
// userId exclusively from the actor" (D8) — one rule, applied here to the
// first of the 2 mutating use cases. `NuevaMascotaInput` (this file's own
// input shape, mirrored by `NuevaMascotaDto`) has NO `userId` field at
// all — structurally nothing to leak from, same guarantee
// `CargarProductoCatalogoUseCase`'s `NuevoProductoProveedor` gives `catalogo`.

function buildRepository(): jest.Mocked<PetRepository> {
  return {
    save: jest.fn().mockResolvedValue(undefined),
    findById: jest.fn(),
    findByUserId: jest.fn(),
  };
}

const datos = {
  nombre: 'Firulais',
  especie: 'perro',
  raza: 'Labrador',
  pesoKg: 25,
};

describe('RegistrarMascotaUseCase', () => {
  it('creates a Pet scoped to userId=A, persists it via PetRepository.save, and returns it', async () => {
    const petRepository = buildRepository();
    const useCase = new RegistrarMascotaUseCase(petRepository);

    const result = await useCase.execute('user-a', datos);

    expect(result).toMatchObject({
      userId: 'user-a',
      nombre: 'Firulais',
      especie: 'perro',
      raza: 'Labrador',
      pesoKg: 25,
    });
    expect(petRepository.save).toHaveBeenCalledTimes(1);
    expect(petRepository.save).toHaveBeenCalledWith(expect.objectContaining({ userId: 'user-a' }));
  });

  it('derives userId exclusively from the explicit userId param — the input shape has no userId field to leak from (core-api-consumo "A client-supplied userId cannot influence the write")', async () => {
    const petRepository = buildRepository();
    const useCase = new RegistrarMascotaUseCase(petRepository);

    await useCase.execute('user-b', datos);

    expect(petRepository.save).toHaveBeenCalledWith(expect.objectContaining({ userId: 'user-b' }));
  });

  it('generates a fresh randomUUID() id per call — never a DB default (D-H.1 precedent: cargarProductoCatalogo/registrarEmpresa)', async () => {
    const petRepository = buildRepository();
    const useCase = new RegistrarMascotaUseCase(petRepository);

    await useCase.execute('user-a', datos);
    await useCase.execute('user-a', datos);

    const calls = petRepository.save.mock.calls as [Pet][];
    const [[firstPet], [secondPet]] = calls;
    expect(firstPet.id).toMatch(/^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i);
    expect(firstPet.id).not.toBe(secondPet.id);
  });

  it('accepts a minimal payload without the optional raza/pesoKg fields', async () => {
    const petRepository = buildRepository();
    const useCase = new RegistrarMascotaUseCase(petRepository);

    const result = await useCase.execute('user-a', { nombre: 'Michi', especie: 'gato' });

    expect(result).toMatchObject({ userId: 'user-a', nombre: 'Michi', especie: 'gato' });
    expect(result.raza).toBeUndefined();
    expect(result.pesoKg).toBeUndefined();
  });
});
