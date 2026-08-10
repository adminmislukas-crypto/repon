import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';
import type { ConsumptionKind, OwnerType } from '@repon/types';

/** Response shape for `configurarConsumo` (201) — mirrors `@repon/types`' `UserConsumption`. */
export class UserConsumptionResponseDto {
  @ApiProperty({ format: 'uuid' })
  id!: string;

  @ApiProperty({ format: 'uuid' })
  userId!: string;

  @ApiProperty({ enum: ['self', 'pet'] })
  ownerType!: OwnerType;

  @ApiPropertyOptional({ format: 'uuid' })
  petId?: string;

  @ApiProperty({ enum: ['medicamento', 'alimento', 'vacuna', 'suplemento'] })
  kind!: ConsumptionKind;

  @ApiProperty()
  nombre!: string;

  @ApiProperty()
  dosisPorToma!: number;

  @ApiPropertyOptional()
  unidad?: string;

  @ApiProperty()
  frecuenciaDias!: number;

  @ApiProperty({ type: [String] })
  horarios!: string[];

  @ApiProperty()
  stockActual!: number;

  @ApiProperty()
  autoCrearRefill!: boolean;
}
