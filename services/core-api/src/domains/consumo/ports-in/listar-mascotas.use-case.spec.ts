import type { Pet } from '@repon/types';
import type { PetRepository } from '../ports-out/pet-repository.port';
import { ListarMascotasUseCase } from './listar-mascotas.use-case';

// usuario-mobile-consumo design.md D-5: `GET /consumo/mis-mascotas`. `userId`
// is the ONLY scoping mechanism (D-4) — this use case is a thin pass-through
// over `PetRepository.findByUserId`, so its own tests just prove that
// pass-through is exact, not reinterpreted.

function buildRepository(): jest.Mocked<PetRepository> {
  return { save: jest.fn(), findById: jest.fn(), findByUserId: jest.fn() };
}

function buildPet(overrides: Partial<Pet> = {}): Pet {
  return { id: 'pet-1', userId: 'user-a', nombre: 'Firulais', especie: 'perro', ...overrides };
}

describe('ListarMascotasUseCase', () => {
  it('returns exactly what PetRepository.findByUserId returns, for the given userId', async () => {
    const repository = buildRepository();
    const pets = [buildPet(), buildPet({ id: 'pet-2', nombre: 'Michi', especie: 'gato' })];
    repository.findByUserId.mockResolvedValue(pets);
    const useCase = new ListarMascotasUseCase(repository);

    const result = await useCase.execute('user-a');

    expect(result).toEqual(pets);
    expect(repository.findByUserId).toHaveBeenCalledWith('user-a');
  });

  it('returns an empty array for a user with no pets — never throws, never a 404-shaped error', async () => {
    const repository = buildRepository();
    repository.findByUserId.mockResolvedValue([]);
    const useCase = new ListarMascotasUseCase(repository);

    await expect(useCase.execute('user-with-nothing')).resolves.toEqual([]);
  });

  it('calls findByUserId exactly once, regardless of how many pets come back', async () => {
    const repository = buildRepository();
    repository.findByUserId.mockResolvedValue([buildPet(), buildPet({ id: 'pet-2' })]);
    const useCase = new ListarMascotasUseCase(repository);

    await useCase.execute('user-a');

    expect(repository.findByUserId).toHaveBeenCalledTimes(1);
  });
});
