import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';
import { Type } from 'class-transformer';
import {
  ArrayNotEmpty,
  IsArray,
  IsOptional,
  IsString,
  IsUUID,
  ValidateNested,
} from 'class-validator';
import { DatosEntregaDto } from './datos-entrega.dto';
import { NuevoOfferItemDto } from './nuevo-offer-item.dto';

/**
 * `POST /ofertas/proactivas` body (design.md Diagrama 2, línea 662) —
 * `{ userId, items: NuevoOfferItemDto[], entrega, mensaje? }`. `userId` **SÍ**
 * está presente acá — la ÚNICA excepción deliberada a la regla de D11 ("un
 * DTO nunca acepta un id que pertenezca a otro actor desde el cliente"), y es
 * segura precisamente porque el chequeo `existeRelacion` de D10
 * (`EnviarOfertaProactivaUseCase`'s paso 3) la acota: un proveedor solo puede
 * apuntar proactivamente a un usuario con el que alguna vez fue elegible
 * (matcheado), nunca a cualquier `userId` arbitrario del sistema. `companyId`
 * sigue derivándose exclusivamente de `actor.companyId` (D11 intacta para ese
 * campo), igual que `EnviarOfertaDto`.
 *
 * Reutiliza `NuevoOfferItemDto`/`DatosEntregaDto` sin cambios (ambos ya
 * genéricos por diseño, `nuevo-offer-item.dto.ts`'s own doc comment) —
 * `items[].providerCatalogItemId` es el discriminante que esta ruta necesita,
 * `refillItemId` queda simplemente sin usar. `mensaje` es el único campo
 * nuevo frente a `EnviarOfertaDto`, mapea 1:1 a `crearOfertaProactiva`'s
 * quinto parámetro opcional (Phase 2).
 */
export class EnviarOfertaProactivaDto {
  @ApiProperty({
    format: 'uuid',
    description:
      'Usuario destinatario — DEBE tener una relación previa con esta empresa (D10), ' +
      'validada por el caso de uso, nunca confiada de este campo por sí solo.',
  })
  @IsUUID()
  userId!: string;

  @ApiProperty({ type: [NuevoOfferItemDto] })
  @IsArray()
  @ArrayNotEmpty()
  @ValidateNested({ each: true })
  @Type(() => NuevoOfferItemDto)
  items!: NuevoOfferItemDto[];

  @ApiProperty({ type: DatosEntregaDto })
  @ValidateNested()
  @Type(() => DatosEntregaDto)
  entrega!: DatosEntregaDto;

  @ApiPropertyOptional()
  @IsOptional()
  @IsString()
  mensaje?: string;
}
