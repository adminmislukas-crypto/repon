import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';
import type { ConsumptionKind, OwnerType } from '@repon/types';
import {
  ArrayNotEmpty,
  IsArray,
  IsBoolean,
  IsIn,
  IsInt,
  IsNotEmpty,
  IsNumber,
  IsOptional,
  IsString,
  IsUUID,
  Min,
} from 'class-validator';

const OWNER_TYPES: readonly OwnerType[] = ['self', 'pet'];
const CONSUMPTION_KINDS: readonly ConsumptionKind[] = [
  'medicamento',
  'alimento',
  'vacuna',
  'suplemento',
];

/**
 * `POST /consumo/mis-consumos` body. Mirrors `ConfigurarConsumoUseCase`'s
 * `NuevoConsumoInput` field-for-field, with deliberately NO `userId` field
 * (D8, core-api-consumo spec: "the DTO for these routes has no userId
 * field"). `petId`, when present, is the one client-supplied FK this domain
 * has (D-H.3) — validated here only for shape (`@IsUUID()`); ownership is
 * a use-case-level, I/O-backed check (`ConfigurarConsumoUseCase`), never a
 * DTO-level one.
 *
 * Field-level validation mirrors `domain/user-consumption.entity.ts`'s
 * `crear()` invariants (`dosisPorToma > 0`, `horarios` non-empty) as an
 * early 400 — the entity remains the single source of truth for the
 * invariant itself, never trusted away here.
 */
export class NuevoConsumoDto {
  @ApiProperty({ enum: OWNER_TYPES })
  @IsIn(OWNER_TYPES)
  ownerType!: OwnerType;

  @ApiPropertyOptional({ format: 'uuid' })
  @IsOptional()
  @IsUUID()
  petId?: string;

  @ApiProperty({ enum: CONSUMPTION_KINDS })
  @IsIn(CONSUMPTION_KINDS)
  kind!: ConsumptionKind;

  @ApiProperty({ example: 'Losartan' })
  @IsString()
  @IsNotEmpty()
  nombre!: string;

  @ApiProperty({ example: 1 })
  @IsNumber()
  @Min(0.01)
  dosisPorToma!: number;

  @ApiPropertyOptional({ example: 'mg' })
  @IsOptional()
  @IsString()
  unidad?: string;

  @ApiProperty({ example: 1 })
  @IsInt()
  @Min(1)
  frecuenciaDias!: number;

  @ApiProperty({ example: ['08:00', '20:00'], type: [String] })
  @IsArray()
  @ArrayNotEmpty()
  @IsString({ each: true })
  horarios!: string[];

  @ApiProperty({ example: 10 })
  @IsNumber()
  @Min(0)
  stockActual!: number;

  @ApiProperty({ example: false })
  @IsBoolean()
  autoCrearRefill!: boolean;
}
