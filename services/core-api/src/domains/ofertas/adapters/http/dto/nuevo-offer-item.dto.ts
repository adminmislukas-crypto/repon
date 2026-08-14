import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';
import {
  IsBoolean,
  IsNotEmpty,
  IsNumber,
  IsOptional,
  IsString,
  IsUUID,
  Min,
  ValidateIf,
} from 'class-validator';

/**
 * Mirrors `NuevoOfferItem` (`@repon/types`, `NuevoOfferItemReactiva |
 * NuevoOfferItemProactiva`) — reused by BOTH `EnviarOfertaDto.items` (5b,
 * reactiva-only route, `POST /ofertas`) and `EnviarOfertaProactivaDto.items`
 * (6b, proactiva-only route, tasks.md 6b.5), so both discriminant fields
 * (`refillItemId`/`providerCatalogItemId`) are declared OPTIONAL here:
 * which one is REQUIRED for a given request is a function of which route
 * the item travels on, not something one shared `class-validator` DTO can
 * encode structurally on its own (no native discriminated-union support,
 * unlike `NuevoOfferItem`'s compile-time `?: never` pair). Each route's own
 * mapper (`ofertas.mapper.ts`'s `toNuevoOfertaItemsReactiva`, this PR; a
 * proactiva counterpart lands in 6b) narrows to the exact
 * `NuevoOfferItemReactiva`/`NuevoOfferItemProactiva` shape; a genuinely
 * absent `refillItemId` reaching the 5b route surfaces as
 * `OfertaInvalidaError` (400) from `EnviarOfertaUseCase`'s own step-6
 * membership check (it can never match a real `oportunidad.items` id) —
 * same discipline `NuevoProductoDto`'s own doc comment establishes for a
 * cross-field invariant ("stays a domain concern... never trusting the DTO
 * layer alone").
 *
 * `isAlt ⇒ altNote` (`@repon/types`' `OfferItemAlt` doc comment,
 * `shared-types-package` spec: "Validation rules documented in SPEC.md live
 * in the type/DTO, not only the form") IS enforced here, via `@ValidateIf` —
 * the one invariant this DTO both CAN and SHOULD check directly, unlike the
 * exclusivity rule above. `offer.entity.ts`'s `assertItemValido` re-checks
 * the exact same rule regardless (never trusts this layer away, PR2's own
 * doc-comment discipline: "a DTO HTTP antes de que corra class-validator...
 * puede llegar acá con altNote ausente").
 */
export class NuevoOfferItemDto {
  @ApiPropertyOptional({
    format: 'uuid',
    description: 'Presente en un item de oferta reactiva (responde a un RefillRequest).',
  })
  @IsOptional()
  @IsUUID()
  refillItemId?: string;

  @ApiPropertyOptional({
    format: 'uuid',
    description: 'Presente en un item de oferta proactiva (sin RefillRequest de origen).',
  })
  @IsOptional()
  @IsUUID()
  providerCatalogItemId?: string;

  @ApiProperty({ example: 15990 })
  @IsNumber()
  @Min(0)
  precio!: number;

  @ApiProperty()
  @IsBoolean()
  isAlt!: boolean;

  @ApiPropertyOptional({ description: 'Requerido cuando isAlt es true.' })
  @ValidateIf((item: NuevoOfferItemDto) => item.isAlt === true)
  @IsString()
  @IsNotEmpty()
  altNote?: string;

  @ApiPropertyOptional()
  @IsOptional()
  @IsNumber()
  @Min(0)
  altSize?: number;

  @ApiPropertyOptional()
  @IsOptional()
  @IsNumber()
  @Min(0)
  altQty?: number;
}
