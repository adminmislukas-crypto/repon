import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';
import { IsNotEmpty, IsNumber, IsOptional, IsString, IsUUID, Min } from 'class-validator';

/**
 * One entry of `CrearSolicitudDto.items`. Mirrors `@repon/types`'
 * `NuevoRefillItem` field-for-field — that shared interface deliberately
 * carries NO validation decorators itself (its own doc comment: "eso vive
 * en el DTO de `adapters/http/`, igual que `NuevoProductoProveedor`").
 *
 * Field-level validation mirrors `crearSolicitudActiva()`'s (Phase 2)
 * `assertSolicitudValida` invariants (non-empty `nombre`/`categoria`,
 * non-negative `precioReferencia`) as an early 400 — the domain factory
 * remains the single source of truth for the invariant itself, never
 * trusted away here. Same defense-in-depth precedent `NuevaMascotaDto`/
 * `NuevoConsumoDto`/`NuevoProductoDto` already established in this repo.
 */
export class NuevoRefillItemDto {
  @ApiProperty({ example: 'Losartan 50mg' })
  @IsString()
  @IsNotEmpty()
  nombre!: string;

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
