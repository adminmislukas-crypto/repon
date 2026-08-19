import type { AdherenciaSemanal, Pet, UserConsumption, UserConsumptionListItem } from '@repon/types';
import type { NuevaMascotaInput } from '../../ports-in/registrar-mascota.use-case';
import type { NuevoConsumoInput } from '../../ports-in/configurar-consumo.use-case';
import type { AdherenciaResponseDto } from './dto/adherencia-response.dto';
import type { ConsumoListItemResponseDto } from './dto/consumo-list-item-response.dto';
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

/**
 * `GET /consumo/mis-consumos` row shape (usuario-mobile-consumo design.md
 * D-5). `Number.isFinite` guard: a degenerate row (e.g. `horarios: []`
 * predating that column's non-empty constraint) makes
 * `ListarConsumosUseCase`'s raw `diasRestantes` calculation `Infinity`/`NaN`
 * — both serialize as JSON `null` if sent as-is, which the client has no
 * defined handling for. `0` is the same "nothing left" signal
 * `diasRestantes()` itself already returns for a genuinely empty stock, so
 * this guard never introduces a new value the client hasn't already seen.
 */
export function toConsumoListItemResponseDto(
  item: UserConsumptionListItem,
): ConsumoListItemResponseDto {
  return {
    ...toUserConsumptionResponseDto(item),
    diasRestantes: Number.isFinite(item.diasRestantes) ? item.diasRestantes : 0,
  };
}

/**
 * `GET /consumo/mi-adherencia` response shape (usuario-mobile-consumo
 * design.md D-2). `@repon/types.AdherenciaSemanal`/`AdherenciaItem`/
 * `AdherenciaDia` already match this DTO field-for-field — no conversion
 * logic here, same "thin scalar <-> DTO" role every other mapper function
 * in this file has. All aggregation happens in
 * `CalcularAdherenciaSemanalUseCase`, never here.
 */
export function toAdherenciaResponseDto(adherencia: AdherenciaSemanal): AdherenciaResponseDto {
  return {
    desde: adherencia.desde,
    hasta: adherencia.hasta,
    porcentaje: adherencia.porcentaje,
    rachaDias: adherencia.rachaDias,
    dias: adherencia.dias.map((dia) => ({
      fecha: dia.fecha,
      esperadas: dia.esperadas,
      tomadas: dia.tomadas,
      estado: dia.estado,
    })),
    items: adherencia.items.map((item) => ({
      consumptionId: item.consumptionId,
      nombre: item.nombre,
      ownerType: item.ownerType,
      petId: item.petId,
      kind: item.kind,
      esperadas: item.esperadas,
      tomadas: item.tomadas,
      porcentaje: item.porcentaje,
      dias: item.dias.map((dia) => ({
        fecha: dia.fecha,
        esperadas: dia.esperadas,
        tomadas: dia.tomadas,
        estado: dia.estado,
      })),
    })),
  };
}
