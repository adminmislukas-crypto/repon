import type { Pet } from '@repon/types';
import type { TransactionContext } from '../../../shared/database/transaction';

/**
 * NEW port (design.md D-H.1): `consumo/SPEC.md` already declares
 * `ConsumoInboundPort.registrarMascota(userId, datos): Promise<Pet>`, but
 * its "Puertos de salida" block only ever listed `ConsumptionRepository`/
 * `ConsumptionLogRepository` — there was no way to persist a `Pet`. Kept
 * separate from `ConsumptionRepository` on purpose: folding `save`/`findById`
 * for `Pet` into that interface would make it lie about its name and couple
 * the persistence of two agregates that live in distinct tables
 * (`pets`/`user_consumption`).
 *
 * `findById` exists for `configurarConsumo`'s ownership check (D-H.3): the
 * same D7 cross-tenant rule applied to the one client-supplied FK
 * (`petId`) this domain has — look it up, verify `pet.userId ===
 * actor.profileId`, 404 (never 403) on mismatch or absence.
 */
export interface PetRepository {
  save(pet: Pet, tx?: TransactionContext): Promise<void>;
  findById(petId: string, tx?: TransactionContext): Promise<Pet | null>;

  /**
   * usuario-mobile-consumo design.md D-3/D-4: powers `GET /consumo/mis-mascotas`
   * (`ListarMascotasUseCase`). `userId` is the actor's own id — the ONLY
   * scoping mechanism, never a client-supplied filter (D-4). Ordered by
   * `created_at` so list order is stable across refetches. An empty result
   * is a valid, expected value (a user with no pets yet) — never throws.
   */
  findByUserId(userId: string, tx?: TransactionContext): Promise<Pet[]>;
}

export const PET_REPOSITORY = Symbol('PET_REPOSITORY');
