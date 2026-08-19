import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';
import type { AdherenciaEstado, ConsumptionKind, OwnerType } from '@repon/types';

/**
 * `GET /consumo/mi-adherencia` response shapes (usuario-mobile-consumo
 * design.md D-2). `estado` is a 4-value enum, never raw `esperadas`/
 * `tomadas` compared client-side — the client renders a colour from
 * `estado`, it never recomputes adherence (D6).
 */
export class AdherenciaDiaDto {
  @ApiProperty({ description: "'YYYY-MM-DD', in the domain's fixed adherence timezone." })
  fecha!: string;

  @ApiProperty({ description: 'May be fractional when frecuenciaDias > 1.' })
  esperadas!: number;

  @ApiProperty()
  tomadas!: number;

  @ApiProperty({ enum: ['cumplido', 'parcial', 'incumplido', 'sin_datos'] })
  estado!: AdherenciaEstado;
}

export class AdherenciaItemDto {
  @ApiProperty({ format: 'uuid' })
  consumptionId!: string;

  @ApiProperty()
  nombre!: string;

  @ApiProperty({ enum: ['self', 'pet'] })
  ownerType!: OwnerType;

  @ApiPropertyOptional({ format: 'uuid' })
  petId?: string;

  @ApiProperty({ enum: ['medicamento', 'alimento', 'vacuna', 'suplemento'] })
  kind!: ConsumptionKind;

  @ApiProperty({ description: 'Over the whole 7-day window, not per-day.' })
  esperadas!: number;

  @ApiProperty()
  tomadas!: number;

  @ApiProperty({ description: 'Integer 0-100, clamped.' })
  porcentaje!: number;

  @ApiProperty({ type: [AdherenciaDiaDto], description: 'Exactly 7 entries, oldest first.' })
  dias!: AdherenciaDiaDto[];
}

export class AdherenciaResponseDto {
  @ApiProperty({ description: "'YYYY-MM-DD' = today - 6." })
  desde!: string;

  @ApiProperty({ description: "'YYYY-MM-DD' = today." })
  hasta!: string;

  @ApiProperty({ description: 'Integer 0-100, clamped, aggregated across all items.' })
  porcentaje!: number;

  @ApiProperty({ description: 'Consecutive cumplido days counted backwards from yesterday.' })
  rachaDias!: number;

  @ApiProperty({ type: [AdherenciaDiaDto], description: 'Exactly 7 entries, aggregate across items.' })
  dias!: AdherenciaDiaDto[];

  @ApiProperty({ type: [AdherenciaItemDto] })
  items!: AdherenciaItemDto[];
}
