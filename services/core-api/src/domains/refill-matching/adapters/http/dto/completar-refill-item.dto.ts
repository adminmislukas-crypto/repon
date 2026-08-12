import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';
import { IsNotEmpty, IsNumber, IsOptional, IsString, IsUUID, Min } from 'class-validator';

/**
 * One entry of `CompletarBorradorDto.items`. Structurally mirrors
 * `CompletarRefillItemInput` (`domain/refill-request.entity.ts`, PR2 —
 * re-exported by `ports-in/completar-borrador.use-case.ts`, D-B) field for
 * field: `refillItemId`, `categoria`, `precioReferencia`, `catalogProductId?`.
 * That domain type carries no validation decorators itself (same split
 * `NuevoRefillItem`/`NuevoRefillItemDto` already established) — this class
 * is where the `class-validator` decorators live.
 *
 * `refillItemId` is validated as a UUID but NOT checked against the
 * borrador's own items here — "does this id belong to THIS borrador" is a
 * domain invariant (`completar()`, Phase 2), not a shape invariant; an
 * unknown id still passes DTO validation and surfaces as
 * `RefillItemDesconocidoError` (400 `REFILL_ITEM_DESCONOCIDO`) at the
 * use-case layer.
 */
export class CompletarRefillItemDto {
  @ApiProperty({
    format: 'uuid',
    description: 'DEBE referenciar un refill_items.id del borrador que se está completando.',
  })
  @IsUUID()
  refillItemId!: string;

  @ApiProperty({ example: 'Medicamentos' })
  @IsString()
  @IsNotEmpty()
  categoria!: string;

  @ApiProperty({ example: 5990 })
  @IsNumber()
  @Min(0)
  precioReferencia!: number;

  @ApiPropertyOptional({
    format: 'uuid',
    description: 'Opcional (D-B): el usuario puede pedir un producto que no está en el catálogo.',
  })
  @IsOptional()
  @IsUUID()
  catalogProductId?: string;
}
