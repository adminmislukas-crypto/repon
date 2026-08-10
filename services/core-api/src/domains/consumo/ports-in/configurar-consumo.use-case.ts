import { randomUUID } from 'node:crypto';
import { Inject, Injectable } from '@nestjs/common';
import type { UserConsumption } from '@repon/types';
import { PetNotFoundError } from '../domain/consumo.errors';
import { crear } from '../domain/user-consumption.entity';
import {
  CONSUMPTION_REPOSITORY,
  type ConsumptionRepository,
} from '../ports-out/consumption-repository.port';
import { PET_REPOSITORY, type PetRepository } from '../ports-out/pet-repository.port';

/**
 * `consumo/SPEC.md`'s `configurarConsumo(userId, config): Promise<UserConsumption>`
 * — the "config" shape, defined here (same reasoning as
 * `registrar-mascota.use-case.ts`'s `NuevaMascotaInput`: no shared-types
 * input type exists for it yet, so it lives beside its only caller).
 * Deliberately has NO `userId` field (D8) — `NuevoConsumoDto` mirrors this
 * shape field-for-field.
 */
export interface NuevoConsumoInput {
  ownerType: UserConsumption['ownerType'];
  petId?: string;
  kind: UserConsumption['kind'];
  nombre: string;
  dosisPorToma: number;
  unidad?: string;
  frecuenciaDias: number;
  horarios: readonly string[];
  stockActual: number;
  autoCrearRefill: boolean;
}

/**
 * core-api-consumo spec, "configurarConsumo verifies a client-supplied
 * petId belongs to the same user, before creating the consumption" (D-H.3)
 * — D7's ownership rule applied to the one client-supplied FK this domain
 * has. When `config.petId` is present, `PetRepository.findById` is looked
 * up and compared against `userId` BEFORE `crear()`/`save()` ever run — a
 * rejected check leaves zero partial state (no `UserConsumption` is
 * created). `petId` missing and `petId` belonging to another user throw the
 * EXACT SAME `PetNotFoundError`, constructed the exact same way (Diagrama 3:
 * "Byte a byte idéntico a la rama 'no existe'") — a 403 would confirm the
 * pet exists and belongs to someone else, letting an actor enumerate
 * `petId` to probe another user's pets. 404 in both branches closes that
 * channel.
 *
 * `userId` is an explicit param the controller derives from
 * `actor.profileId` (D8) — never re-derived or trusted from `config`, which
 * has no `userId` field to trust in the first place.
 *
 * `id` is generated here via `randomUUID()` — never a DB default (D-H.1's
 * repo-wide precedent).
 */
@Injectable()
export class ConfigurarConsumoUseCase {
  constructor(
    @Inject(CONSUMPTION_REPOSITORY) private readonly consumptionRepository: ConsumptionRepository,
    @Inject(PET_REPOSITORY) private readonly petRepository: PetRepository,
  ) {}

  async execute(userId: string, config: NuevoConsumoInput): Promise<UserConsumption> {
    if (config.petId !== undefined) {
      const pet = await this.petRepository.findById(config.petId);
      if (!pet || pet.userId !== userId) {
        throw new PetNotFoundError(config.petId);
      }
    }

    const consumption = crear({ id: randomUUID(), userId, ...config });
    await this.consumptionRepository.save(consumption);
    return consumption;
  }
}
