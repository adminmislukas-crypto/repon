import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';
import {
  IsBoolean,
  IsInt,
  IsNotEmpty,
  IsNumber,
  IsOptional,
  IsString,
  IsUUID,
  Min,
} from 'class-validator';

/**
 * `POST /catalogo/mi-catalogo` body. Mirrors `@repon/types`' `NuevoProductoProveedor`
 * (D12) field-for-field, with deliberately NO `companyId` field (D8,
 * design.md: "el DTO NO tiene companyId. No existe tal campo") — the only
 * `companyId` reaching `CargarProductoCatalogoUseCase` is `actor.companyId`,
 * derived by the controller; there is nothing in this body to trust or
 * ignore.
 *
 * Field-level validation lives HERE, not on the shared type
 * (`NuevoProductoProveedor`'s own doc comment in `@repon/types`, the
 * `shared-types-package` delta: "enforced at the type/DTO layer in
 * `core-api`'s `adapters/http/`, never here"): non-empty `nombre`/
 * `categoria`, finite non-negative prices (`@IsNumber()` rejects
 * `NaN`/`Infinity` by default — `Number.isFinite` under the hood), a
 * non-negative integer `stock`. These are the same checks design.md's
 * Diagram 1 (step 2a) names for the bulk-load row path, applied here for
 * the single-item path. The cross-field invariant `precioMaximo >=
 * precioBase` is NOT re-validated here — that stays a domain concern,
 * enforced in `provider-catalog-item.entity.ts`'s `crear()` (never trusting
 * the DB CHECK either).
 */
export class NuevoProductoDto {
  @ApiPropertyOptional({ format: 'uuid' })
  @IsOptional()
  @IsUUID()
  catalogProductId?: string;

  @ApiProperty({ example: 'Agua Purificada 5L' })
  @IsString()
  @IsNotEmpty()
  nombre!: string;

  @ApiProperty({ example: 'Bebidas' })
  @IsString()
  @IsNotEmpty()
  categoria!: string;

  @ApiProperty({ example: 1000 })
  @IsNumber()
  @Min(0)
  precioBase!: number;

  @ApiProperty({ example: 1500 })
  @IsNumber()
  @Min(0)
  precioMaximo!: number;

  @ApiProperty({ example: 10 })
  @IsInt()
  @Min(0)
  stock!: number;

  @ApiPropertyOptional()
  @IsOptional()
  @IsBoolean()
  disponible?: boolean;

  @ApiPropertyOptional()
  @IsOptional()
  @IsString()
  imagenUrl?: string;
}
