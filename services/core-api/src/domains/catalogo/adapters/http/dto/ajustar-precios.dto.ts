import { ApiProperty } from '@nestjs/swagger';
import { IsNotEmpty, IsNumber, IsString } from 'class-validator';

/**
 * `POST /catalogo/mi-catalogo/ajustes-de-precio` body. NO `companyId` field
 * (D8) — `companyId` reaches `AjustarPreciosPorCategoriaUseCase` only via
 * `actor.companyId`, derived by the controller.
 *
 * `porcentaje` deliberately carries NO `@Min()`/lower-bound decorator: the
 * `porcentaje <= -100` business rule is a domain concern
 * (`PorcentajeInvalidoError`, checked by the use case itself), never
 * duplicated here — same convention `ActualizarPrecioDto`'s own doc comment
 * already states for the cross-field price invariant ("stays a domain
 * concern, never re-validated here").
 */
export class AjustarPreciosDto {
  @ApiProperty({ example: 'Bebidas', description: 'La categoría propia a ajustar.' })
  @IsString()
  @IsNotEmpty()
  categoria!: string;

  @ApiProperty({
    example: 10,
    description:
      'Porcentaje a aplicar sobre precioBase/precioMaximo (10 = +10%, -10 = -10%). ' +
      'Un valor <= -100 es inválido (400 PORCENTAJE_INVALIDO).',
  })
  @IsNumber()
  porcentaje!: number;
}
