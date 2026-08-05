import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';
import type { CatalogProductStatus } from '@repon/types';

/** Response shape for `buscarProductos` (200) — mirrors `@repon/types`' `CatalogProduct`. */
export class CatalogProductResponseDto {
  @ApiProperty({ format: 'uuid' })
  id!: string;

  @ApiProperty()
  nombre!: string;

  @ApiProperty()
  categoria!: string;

  @ApiPropertyOptional()
  marca?: string;

  @ApiPropertyOptional()
  presentacion?: string;

  @ApiPropertyOptional()
  imagenUrl?: string;

  @ApiProperty({ enum: ['activo', 'inactivo'] })
  status!: CatalogProductStatus;
}
