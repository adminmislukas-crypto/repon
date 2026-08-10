import type { Pet, UserConsumption } from '@repon/types';
import type { NuevaMascotaInput } from '../../ports-in/registrar-mascota.use-case';
import type { NuevoConsumoInput } from '../../ports-in/configurar-consumo.use-case';
import type { DiasRestantesResponseDto } from './dto/dias-restantes-response.dto';
import type { NuevaMascotaDto } from './dto/nueva-mascota.dto';
import type { NuevoConsumoDto } from './dto/nuevo-consumo.dto';
import type { PetResponseDto } from './dto/pet-response.dto';
import type { UserConsumptionResponseDto } from './dto/user-consumption-response.dto';

/**
 * `core-api-hexagonal-layout` spec, "DTOs and framework decorators stay in
 * adapters/http": the thin scalar <-> response-DTO conversion, kept free of
 * business logic (that lives in `ports-in/calcular-dias-restantes.use-case.ts`
 * and `domain/consumo.calculos.ts`). More `toXResponseDto` functions land
 * here as PR3/PR4's routes add `PetResponseDto`/`UserConsumptionResponseDto`
 * — this file is appended to, not one-mapper-per-file (mirrors `catalogo`'s
 * `catalogo.mapper.ts`).
 */
export function toDiasRestantesResponseDto(diasRestantes: number): DiasRestantesResponseDto {
  return { diasRestantes };
}

/**
 * `POST /consumo/mis-mascotas` body -> `RegistrarMascotaUseCase`'s `datos`
 * param. Deliberately does NOT read a `userId` off `dto` — it has none
 * (D8); the controller supplies `userId` separately, from `actor.profileId`.
 */
export function toNuevaMascotaInput(dto: NuevaMascotaDto): NuevaMascotaInput {
  return { nombre: dto.nombre, especie: dto.especie, raza: dto.raza, pesoKg: dto.pesoKg };
}

/** Response shape for `registrarMascota` (201). */
export function toPetResponseDto(pet: Pet): PetResponseDto {
  return {
    id: pet.id,
    userId: pet.userId,
    nombre: pet.nombre,
    especie: pet.especie,
    raza: pet.raza,
    pesoKg: pet.pesoKg,
  };
}

/**
 * `POST /consumo/mis-consumos` body -> `ConfigurarConsumoUseCase`'s
 * `config` param. Deliberately does NOT read a `userId` off `dto` — same
 * reasoning as `toNuevaMascotaInput` above (D8).
 */
export function toNuevoConsumoInput(dto: NuevoConsumoDto): NuevoConsumoInput {
  return {
    ownerType: dto.ownerType,
    petId: dto.petId,
    kind: dto.kind,
    nombre: dto.nombre,
    dosisPorToma: dto.dosisPorToma,
    unidad: dto.unidad,
    frecuenciaDias: dto.frecuenciaDias,
    horarios: dto.horarios,
    stockActual: dto.stockActual,
    autoCrearRefill: dto.autoCrearRefill,
  };
}

/** Response shape for `configurarConsumo` (201). */
export function toUserConsumptionResponseDto(
  consumption: UserConsumption,
): UserConsumptionResponseDto {
  return {
    id: consumption.id,
    userId: consumption.userId,
    ownerType: consumption.ownerType,
    petId: consumption.petId,
    kind: consumption.kind,
    nombre: consumption.nombre,
    dosisPorToma: consumption.dosisPorToma,
    unidad: consumption.unidad,
    frecuenciaDias: consumption.frecuenciaDias,
    horarios: consumption.horarios,
    stockActual: consumption.stockActual,
    autoCrearRefill: consumption.autoCrearRefill,
  };
}
