import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';
import type { Urgencia } from '@repon/types';
import { Type } from 'class-transformer';
import {
  ArrayNotEmpty,
  IsArray,
  IsIn,
  IsNotEmpty,
  IsOptional,
  IsString,
  ValidateNested,
} from 'class-validator';
import { CompletarRefillItemDto } from './completar-refill-item.dto';

const URGENCIAS: readonly Urgencia[] = ['lo_antes_posible', 'hoy', 'manana', 'en_2_3_dias'];

/**
 * `POST /refill/mis-solicitudes/:refillRequestId/completar` body
 * (design.md D-E). Structurally the same shape as
 * `CompletarBorradorUseCase.execute`'s `CompletarInput` third parameter
 * (`domain/refill-request.entity.ts`) field for field — the controller
 * passes this DTO instance straight through, no remapping object literal
 * needed, same minimal-plumbing precedent `CrearSolicitudDto` already set
 * for `crearSolicitud`.
 *
 * `urgencia` is OPTIONAL, unlike `CrearSolicitudDto`'s required field:
 * omitting it keeps whatever `urgencia` the borrador already carries
 * (D-G.1 — the listener seeds `'lo_antes_posible'` at creation, and the
 * user confirms or changes it here). `items` covers exactly the borrador's
 * own items — this DTO cannot enforce that count (it has no borrador to
 * compare against), so a mismatch surfaces at the use-case layer instead
 * (`RefillItemDesconocidoError` for an unknown id; `SolicitudIncompletaError`
 * for a borrador item left without `categoria`/`precioReferencia`, D3/D4).
 *
 * No `userId` field, same D13 rule every DTO in this domain follows.
 */
export class CompletarBorradorDto {
  @ApiProperty({ example: 'Av. Siempre Viva 742' })
  @IsString()
  @IsNotEmpty()
  direccion!: string;

  @ApiProperty({ example: 'Providencia' })
  @IsString()
  @IsNotEmpty()
  comuna!: string;

  @ApiPropertyOptional({
    enum: URGENCIAS,
    description: 'Opcional: si se omite, se conserva la urgencia que el borrador ya tenía.',
  })
  @IsOptional()
  @IsIn(URGENCIAS)
  urgencia?: Urgencia;

  @ApiProperty({ type: [CompletarRefillItemDto] })
  @IsArray()
  @ArrayNotEmpty()
  @ValidateNested({ each: true })
  @Type(() => CompletarRefillItemDto)
  items!: CompletarRefillItemDto[];
}
