import { ApiProperty } from '@nestjs/swagger';

/** One entry of `ResultadoCargaMasivaResponseDto.fallos` — mirrors `ResultadoCargaMasiva.fallos[]` (`@repon/types`) field-for-field. */
export class FallaCargaMasivaDto {
  @ApiProperty({ description: '1-based, excluye la fila de cabecera.' })
  numero!: number;

  @ApiProperty()
  motivo!: string;
}

/**
 * Response shape for `cargarCatalogoMasivo` (200) — mirrors
 * `ResultadoCargaMasiva` (`@repon/types`, D12) field-for-field.
 * `totalCargados + totalFallidos` always equals `totalFilas` (core-api-catalogo
 * spec, "cargarCatalogoMasivo processes rows independently and reports
 * partial failure").
 */
export class ResultadoCargaMasivaResponseDto {
  @ApiProperty()
  totalFilas!: number;

  @ApiProperty()
  totalCargados!: number;

  @ApiProperty()
  totalFallidos!: number;

  @ApiProperty({ type: [FallaCargaMasivaDto] })
  fallos!: FallaCargaMasivaDto[];
}
