import { ApiProperty } from '@nestjs/swagger';
import type { Urgencia } from '@repon/types';
import { Type } from 'class-transformer';
import {
  ArrayNotEmpty,
  IsArray,
  IsIn,
  IsNotEmpty,
  IsString,
  ValidateNested,
} from 'class-validator';
import { NuevoRefillItemDto } from './nuevo-refill-item.dto';

const URGENCIAS: readonly Urgencia[] = ['lo_antes_posible', 'hoy', 'manana', 'en_2_3_dias'];

/**
 * `POST /refill/mis-solicitudes` body. Mirrors `CrearSolicitudUseCase.execute`'s
 * `(items, direccion, comuna, urgencia)` parameters field-for-field, with
 * deliberately NO `userId` field — not "ignored if present", it is not
 * declared at all (D13, core-api-refill-matching spec: "No DTO in this
 * domain accepts a client-supplied userId"). The only `userId` reaching
 * the use case is `actor.profileId`, derived by the controller from the
 * authenticated request; there is nothing in this body to trust or ignore.
 * Combined with `main.ts`'s global `ValidationPipe({ whitelist: true,
 * forbidNonWhitelisted: true })`, a client-supplied `userId` in the request
 * body is rejected with 400, never silently dropped.
 *
 * Field-level validation mirrors `crearSolicitudActiva()`'s (Phase 2)
 * top-level invariants (>=1 item, non-empty `direccion`/`comuna`, `urgencia`
 * in the enum) as an early 400 — the domain factory remains the single
 * source of truth for the invariant itself, never trusted away here.
 * `items` validates each entry via `@ValidateNested({ each: true })` +
 * `@Type(() => NuevoRefillItemDto)` (`class-transformer`, already a
 * dependency of this service) — first nested-array DTO validation in this
 * repo, needed because `items` is itself an array of objects, not scalars.
 */
export class CrearSolicitudDto {
  @ApiProperty({ type: [NuevoRefillItemDto] })
  @IsArray()
  @ArrayNotEmpty()
  @ValidateNested({ each: true })
  @Type(() => NuevoRefillItemDto)
  items!: NuevoRefillItemDto[];

  @ApiProperty({ example: 'Av. Siempre Viva 742' })
  @IsString()
  @IsNotEmpty()
  direccion!: string;

  @ApiProperty({ example: 'Providencia' })
  @IsString()
  @IsNotEmpty()
  comuna!: string;

  @ApiProperty({ enum: URGENCIAS })
  @IsIn(URGENCIAS)
  urgencia!: Urgencia;
}
