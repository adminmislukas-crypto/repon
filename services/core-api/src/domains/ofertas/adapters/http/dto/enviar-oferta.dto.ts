import { ApiProperty } from '@nestjs/swagger';
import { Type } from 'class-transformer';
import { ArrayNotEmpty, IsArray, IsUUID, ValidateNested } from 'class-validator';
import { DatosEntregaDto } from './datos-entrega.dto';
import { NuevoOfferItemDto } from './nuevo-offer-item.dto';

/**
 * `POST /ofertas` body (design.md Diagrama 2) — `{ refillRequestId, items:
 * NuevoOfferItemDto[], entrega }`, deliberately NO `companyId` field (D11):
 * "el DTO NO tiene companyId. NO PUEDE tenerlo" — the only `companyId`
 * reaching `EnviarOfertaUseCase` is `actor.companyId`, derived by the
 * controller from the authenticated `@Roles('provider')` actor. Combined
 * with `main.ts`'s global `ValidationPipe({ whitelist: true,
 * forbidNonWhitelisted: true })`, a client-supplied `companyId` in the body
 * is rejected with 400, never silently dropped — same discipline
 * `CrearSolicitudDto`'s own doc comment establishes for `userId` in
 * `refill-matching`.
 *
 * Field-level validation only: `items` non-empty + each entry validated via
 * `@ValidateNested({ each: true })` + `@Type(() => NuevoOfferItemDto)`
 * (`CrearSolicitudDto`'s own precedent, "first nested-array DTO validation
 * in this repo"). `entrega` is the first nested-OBJECT (not array)
 * validation in this repo's DTOs, same `@ValidateNested()`/`@Type()` pair.
 * Every cross-field/domain invariant this DTO does NOT check (item-vs-
 * solicitud membership, catalog match, price ceiling, `0 items`) stays a
 * domain concern (`EnviarOfertaUseCase`/`offer.entity.ts`), never trusted
 * away here.
 */
export class EnviarOfertaDto {
  @ApiProperty({ format: 'uuid' })
  @IsUUID()
  refillRequestId!: string;

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
}
