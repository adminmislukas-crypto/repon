import { Inject, Injectable } from '@nestjs/common';
import type { Kysely, Selectable } from 'kysely';
import type { Pet } from '@repon/types';
import { DATABASE } from '../../../../shared/database/database.module';
import type { DB, PetsTable } from '../../../../shared/database/schema';
import {
  toKyselyTransaction,
  type TransactionContext,
} from '../../../../shared/database/transaction';
import type { PetRepository } from '../../ports-out/pet-repository.port';

/**
 * `peso_kg` round-trips through node-postgres as `string` (design.md's
 * "detalle mecánico de mayor riesgo del cambio" — the same `numeric` gotcha
 * `kysely-consumption.repository.ts` already documents for
 * `dosis_por_toma`/`stock_actual`). This mapper is the ONE place that
 * conversion happens; `domain/pet.entity.ts` and every use case only ever
 * see `number | undefined`.
 */
export function mapPetRow(row: Selectable<PetsTable>): Pet {
  return {
    id: row.id,
    userId: row.user_id,
    nombre: row.nombre,
    especie: row.especie,
    raza: row.raza ?? undefined,
    pesoKg: row.peso_kg !== null ? Number(row.peso_kg) : undefined,
  };
}

/**
 * `PetRepository`'s Kysely-backed implementation (design.md D-H.1, first
 * implementer — this PR). `save()` upserts on `id`, mirroring
 * `KyselyCompanyRepository`'s simplest-shape precedent (a single-column
 * conflict target, no bifurcation the way `KyselyCatalogRepository.save()`
 * needs for `ProviderCatalogItem`'s two partial unique indexes): a pet has
 * no analogous second identity to conflict on. `findById` powers
 * `ConfigurarConsumoUseCase`'s ownership check (D-H.3) — same
 * null-on-miss-never-throw contract as `KyselyConsumptionRepository.findById`.
 */
@Injectable()
export class KyselyPetRepository implements PetRepository {
  constructor(@Inject(DATABASE) private readonly db: Kysely<DB>) {}

  private executor(tx?: TransactionContext) {
    return tx ? toKyselyTransaction(tx) : this.db;
  }

  async save(pet: Pet, tx?: TransactionContext): Promise<void> {
    // `user_id` is intentionally excluded from `update`: an owner never
    // changes via `save()` (no pet-transfer use case exists in this change).
    const update = {
      nombre: pet.nombre,
      especie: pet.especie,
      raza: pet.raza ?? null,
      peso_kg: pet.pesoKg !== undefined ? pet.pesoKg.toFixed(2) : null,
    };
    await this.executor(tx)
      .insertInto('pets')
      .values({ id: pet.id, user_id: pet.userId, ...update })
      .onConflict((oc) => oc.column('id').doUpdateSet(update))
      .execute();
  }

  async findById(petId: string, tx?: TransactionContext): Promise<Pet | null> {
    const row = await this.executor(tx)
      .selectFrom('pets')
      .selectAll()
      .where('id', '=', petId)
      .executeTakeFirst();
    return row ? mapPetRow(row) : null;
  }
}
