import { ApiProperty } from '@nestjs/swagger';
import { IsNumber, Min } from 'class-validator';

/**
 * `PUT /catalogo/mi-catalogo/:itemId/precio` body. NO `companyId` field (D8)
 * and NO `itemId` field — `itemId` travels as a path param, never
 * duplicated in the body (design.md Diagram 3: "el DTO NO tiene companyId.
 * No existe tal campo"). Field-level checks only (finite, non-negative);
 * the cross-field invariant `precioMaximo >= precioBase` is validated in
 * the domain (`provider-catalog-item.entity.ts`'s `actualizarPrecio()`),
 * never here.
 */
export class ActualizarPrecioDto {
  @ApiProperty({ example: 1000 })
  @IsNumber()
  @Min(0)
  precioBase!: number;

  @ApiProperty({ example: 1500 })
  @IsNumber()
  @Min(0)
  precioMaximo!: number;
}
