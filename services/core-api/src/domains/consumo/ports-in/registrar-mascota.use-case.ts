import { randomUUID } from 'node:crypto';
import { Inject, Injectable } from '@nestjs/common';
import type { Pet } from '@repon/types';
import { crear } from '../domain/pet.entity';
import { PET_REPOSITORY, type PetRepository } from '../ports-out/pet-repository.port';

/**
 * `consumo/SPEC.md`'s `registrarMascota(userId, datos): Promise<Pet>` — the
 * "datos" shape, defined here (mirrors `catalogo`'s
 * `CargarProductoCatalogoUseCase` taking `producto: NuevoProductoProveedor`
 * as an explicit param, but this domain has no shared-types input type for
 * it yet, so it lives beside its only caller). Deliberately has NO `userId`
 * field (D8, core-api-consumo spec "A client-supplied userId cannot
 * influence the write") — `NuevaMascotaDto` mirrors this shape field-for-field.
 */
export interface NuevaMascotaInput {
  nombre: string;
  especie: string;
  raza?: string;
  pesoKg?: number;
}

/**
 * core-api-consumo spec, "registrarMascota and configurarConsumo derive
 * userId exclusively from the actor" (D8). `userId` is an explicit param the
 * controller derives from `actor.profileId` — never re-derived or trusted
 * from `datos`, which has no `userId` field to trust in the first place
 * (same shape as `CargarProductoCatalogoUseCase`'s `companyId`).
 *
 * `id` is generated here via `randomUUID()` and passed into the entity
 * factory — never a DB default (design.md D-H.1's repo-wide precedent:
 * `cargarProductoCatalogo`, `registrarEmpresa`, `asignarRolAdmin`).
 */
@Injectable()
export class RegistrarMascotaUseCase {
  constructor(@Inject(PET_REPOSITORY) private readonly petRepository: PetRepository) {}

  async execute(userId: string, datos: NuevaMascotaInput): Promise<Pet> {
    const pet = crear({ id: randomUUID(), userId, ...datos });
    await this.petRepository.save(pet);
    return pet;
  }
}
