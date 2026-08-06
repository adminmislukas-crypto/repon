import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';

/** Response shape for `cargarProductoCatalogo` (201) — mirrors `@repon/types`' `ProviderCatalogItem`. */
export class ProviderCatalogItemResponseDto {
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
