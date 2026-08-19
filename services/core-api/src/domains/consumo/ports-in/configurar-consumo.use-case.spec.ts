import type { Pet } from '@repon/types';
import { PetNotFoundError } from '../domain/consumo.errors';
import type { ConsumptionRepository } from '../ports-out/consumption-repository.port';
import type { PetRepository } from '../ports-out/pet-repository.port';
import { ConfigurarConsumoUseCase } from './configurar-consumo.use-case';

// core-api-consumo spec: "configurarConsumo verifies a client-supplied
// petId belongs to the same user, before creating the consumption"
// (D-H.3) — written FIRST (D16 convention, same order PR2b's R1 test used):
// the negative case (foreign petId -> 404, no UserConsumption created)
// before the happy path. Same D7-shaped rule ActualizarPrecioUseCase
// applies to a cross-tenant company, applied here to the one FK the client
// selects.

function buildConsumptionRepository(): jest.Mocked<ConsumptionRepository> {
  return {
    save: jest.fn().mockResolvedValue(undefined),
    findById: jest.fn(),
    findDueForCheck: jest.fn(),
    intentarMarcarStockBajo: jest.fn(),
    limpiarMarcaStockBajo: jest.fn(),
    descontarStock: jest.fn(),
    findByUserId: jest.fn(),
  };
}

function buildPetRepository(): jest.Mocked<PetRepository> {
  return {
    save: jest.fn(),
    findById: jest.fn(),
    findByUserId: jest.fn(),
  };
}

function buildPet(overrides: Partial<Pet> = {}): Pet {
  return { id: 'pet-1', userId: 'user-a', nombre: 'Firulais', especie: 'perro', ...overrides };
}

const configParaMascota = {
  ownerType: 'pet' as const,
  petId: 'pet-1',
  kind: 'medicamento' as const,
  nombre: 'Losartan',
  dosisPorToma: 1,
  unidad: 'mg',
  frecuenciaDias: 1,
  horarios: ['08:00'],
  stockActual: 10,
  autoCrearRefill: false,
};

const configPropio = {
  ownerType: 'self' as const,
  kind: 'medicamento' as const,
  nombre: 'Losartan',
  dosisPorToma: 1,
  frecuenciaDias: 1,
  horarios: ['08:00'],
  stockActual: 10,
  autoCrearRefill: false,
};

describe('ConfigurarConsumoUseCase', () => {
  describe('petId ownership — negative case FIRST (D16, D-H.3)', () => {
    it('a petId belonging to another user throws PetNotFoundError — never a 403-shaped error — and creates NO UserConsumption', async () => {
      const consumptionRepository = buildConsumptionRepository();
      const petRepository = buildPetRepository();
      petRepository.findById.mockResolvedValue(buildPet({ userId: 'user-b' }));
      const useCase = new ConfigurarConsumoUseCase(consumptionRepository, petRepository);

      await expect(useCase.execute('user-a', configParaMascota)).rejects.toThrow(PetNotFoundError);

      expect(consumptionRepository.save).not.toHaveBeenCalled();
    });

    it('a genuinely missing petId throws the SAME PetNotFoundError — byte-identical, no forbidden channel — and creates NO UserConsumption', async () => {
      const consumptionRepository = buildConsumptionRepository();
      const petRepository = buildPetRepository();
      petRepository.findById.mockResolvedValue(null);
      const useCase = new ConfigurarConsumoUseCase(consumptionRepository, petRepository);

      await expect(useCase.execute('user-a', configParaMascota)).rejects.toThrow(PetNotFoundError);

      expect(consumptionRepository.save).not.toHaveBeenCalled();
    });

    it('both branches produce byte-identical errors — no distinguishing information leaks cross-tenant existence (D7 applied via D-H.3)', async () => {
      const missingRepo = buildPetRepository();
      missingRepo.findById.mockResolvedValue(null);
      const crossTenantRepo = buildPetRepository();
      crossTenantRepo.findById.mockResolvedValue(buildPet({ userId: 'user-b' }));

      const captureError = async (petRepository: jest.Mocked<PetRepository>): Promise<Error> => {
        const useCase = new ConfigurarConsumoUseCase(buildConsumptionRepository(), petRepository);
        try {
          await useCase.execute('user-a', configParaMascota);
          throw new Error('expected execute() to reject, but it resolved');
        } catch (error) {
          return error as Error;
        }
      };
      const missingError = await captureError(missingRepo);
      const crossTenantError = await captureError(crossTenantRepo);

      expect(missingError).toBeInstanceOf(PetNotFoundError);
      expect(crossTenantError).toBeInstanceOf(PetNotFoundError);
      expect(missingError.constructor).toBe(crossTenantError.constructor);
      expect(missingError.message).toBe(crossTenantError.message);
    });
  });

  describe("happy path — configuring a consumption for the caller's own pet succeeds", () => {
    it('creates the UserConsumption scoped to the pet and the caller, and persists it', async () => {
      const consumptionRepository = buildConsumptionRepository();
      const petRepository = buildPetRepository();
      petRepository.findById.mockResolvedValue(buildPet({ userId: 'user-a' }));
      const useCase = new ConfigurarConsumoUseCase(consumptionRepository, petRepository);

      const result = await useCase.execute('user-a', configParaMascota);

      expect(result).toMatchObject({ userId: 'user-a', petId: 'pet-1', ownerType: 'pet' });
      expect(consumptionRepository.save).toHaveBeenCalledTimes(1);
      expect(consumptionRepository.save).toHaveBeenCalledWith(
        expect.objectContaining({ userId: 'user-a', petId: 'pet-1' }),
      );
    });

    it('does not require a pet lookup when configuring a self-owned consumption (no petId)', async () => {
      const consumptionRepository = buildConsumptionRepository();
      const petRepository = buildPetRepository();
      const useCase = new ConfigurarConsumoUseCase(consumptionRepository, petRepository);

      const result = await useCase.execute('user-a', configPropio);

      expect(petRepository.findById).not.toHaveBeenCalled();
      expect(result.ownerType).toBe('self');
      expect(consumptionRepository.save).toHaveBeenCalledTimes(1);
    });
  });

  describe('userId only ever comes from the actor param (D8)', () => {
    it('derives userId exclusively from the explicit userId param, never from config', async () => {
      const consumptionRepository = buildConsumptionRepository();
      const petRepository = buildPetRepository();
      const useCase = new ConfigurarConsumoUseCase(consumptionRepository, petRepository);

      await useCase.execute('user-b', configPropio);

      expect(consumptionRepository.save).toHaveBeenCalledWith(
        expect.objectContaining({ userId: 'user-b' }),
      );
    });
  });

  describe('id generation (D-H.1)', () => {
    it('generates a fresh randomUUID() id — never a DB default', async () => {
      const consumptionRepository = buildConsumptionRepository();
      const petRepository = buildPetRepository();
      const useCase = new ConfigurarConsumoUseCase(consumptionRepository, petRepository);

      const result = await useCase.execute('user-a', configPropio);

      expect(result.id).toMatch(/^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i);
    });
  });

  describe("domain invariants still apply (Phase 2a's crear())", () => {
    it('rejects an invalid config (e.g. empty horarios) via the entity factory — ConsumoInvalidoError', async () => {
      const consumptionRepository = buildConsumptionRepository();
      const petRepository = buildPetRepository();
      const useCase = new ConfigurarConsumoUseCase(consumptionRepository, petRepository);

      await expect(useCase.execute('user-a', { ...configPropio, horarios: [] })).rejects.toThrow();
      expect(consumptionRepository.save).not.toHaveBeenCalled();
    });
  });
});
