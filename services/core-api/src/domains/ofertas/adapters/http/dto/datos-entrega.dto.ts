import { ApiProperty } from '@nestjs/swagger';
import { IsInt, IsNumber, Min } from 'class-validator';

/**
 * Mirrors `DatosEntrega` (`@repon/types`) field-for-field — `enviarOferta`/
 * `enviarOfertaProactiva`'s `entrega` input, `db-schema-ofertas`'s
 * `offers.tiempo_entrega_horas`/`.costo_despacho`. Nested via
 * `EnviarOfertaDto.entrega`'s `@ValidateNested()` + `@Type(() =>
 * DatosEntregaDto)` (`class-transformer`, same convention `CrearSolicitudDto`
 * already established for `items`, extended here to a single nested OBJECT
 * rather than an array).
 */
export class DatosEntregaDto {
  @ApiProperty({ example: 24 })
  @IsInt()
  @Min(0)
  tiempoEntregaHoras!: number;

  @ApiProperty({ example: 3990 })
  @IsNumber()
  @Min(0)
  costoDespacho!: number;
}
