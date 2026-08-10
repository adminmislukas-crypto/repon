import type { DiasRestantesResponseDto } from './dto/dias-restantes-response.dto';

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
