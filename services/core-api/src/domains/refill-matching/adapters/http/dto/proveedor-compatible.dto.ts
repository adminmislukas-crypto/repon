import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';

/**
 * Response shape for `buscarProveedoresCompatibles` (200) — mirrors
 * `@repon/types`' `ProviderCatalogItem` field-for-field, same field list and
 * style as `catalogo`'s own `ProviderCatalogItemResponseDto`
 * (`catalogo/adapters/http/dto/provider-catalog-item-response.dto.ts`),
 * which already serializes this exact same underlying type. Deliberately
 * NOT re-derived from scratch: `ProviderCatalogItem` is `catalogo`'s
 * vocabulary (design.md D-C Decisión 2), and this DTO is this domain's own
 * `adapters/http/` boundary around the raw type
 * `BuscarProveedoresCompatiblesUseCase.execute()` returns (PR5a) —
 * inventing a different shape for the same type would be pure churn with
 * no behavioral difference.
 */
export class ProveedorCompatibleDto {
  @ApiProperty({ format: 'uuid' })
  id!: string;

  @ApiProperty({ format: 'uuid' })
  companyId!: string;

  @ApiPropertyOptional({ format: 'uuid' })
  catalogProductId?: string;

  @ApiProperty()
  nombre!: string;

  @ApiProperty()
  categoria!: string;

  @ApiProperty()
  precioBase!: number;

  @ApiProperty()
  precioMaximo!: number;

  @ApiProperty()
  stock!: number;

  @ApiProperty()
  disponible!: boolean;

  @ApiPropertyOptional()
  imagenUrl?: string;
}
