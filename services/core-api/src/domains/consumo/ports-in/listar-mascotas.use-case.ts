import { Inject, Injectable } from '@nestjs/common';
import type { Pet } from '@repon/types';
import { PET_REPOSITORY, type PetRepository } from '../ports-out/pet-repository.port';

/**
 * usuario-mobile-consumo design.md D-5, `GET /consumo/mis-mascotas`.
 * `userId` is explicit, actor-derived (D8/D-4) — the ONLY scoping
 * mechanism, never re-derived or accepted from a client-supplied filter.
 * A user with no pets gets an empty array, never a 404 — the D-4 "empty is
 * 200 [], never 404" rule: a collection scoped by the actor has no id to
 * probe and nothing to leak, so there's no "not found" case to signal.
 *
 * Structural CQS guarantee (mirrors `CalcularDiasRestantesUseCase`): the
 * constructor injects ONLY `PET_REPOSITORY` — no `EVENT_PUBLISHER`, no
 * `NOTIFICATION_PORT`, no `TRANSACTION_MANAGER`. A list read can never
 * trigger a side effect.
 */
@Injectable()
export class ListarMascotasUseCase {
  constructor(@Inject(PET_REPOSITORY) private readonly petRepository: PetRepository) {}

  async execute(userId: string): Promise<Pet[]> {
    return this.petRepository.findByUserId(userId);
  }
}
