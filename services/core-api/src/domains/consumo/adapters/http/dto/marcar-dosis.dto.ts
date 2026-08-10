import { ApiPropertyOptional } from '@nestjs/swagger';
import { IsISO8601, IsOptional } from 'class-validator';

/**
 * `POST /consumo/mis-consumos/:consumptionId/dosis` body. Deliberately has
 * NO `cantidad` field (D-H.2, core-api-consumo spec: "marcarDosisTomada
 * decrements by the configured dose and never drives stock negative" —
 * the client never supplies a quantity). Combined with `main.ts`'s global
 * `ValidationPipe({ whitelist: true, forbidNonWhitelisted: true })`, a
 * client-supplied `cantidad` in the request body is rejected with 400,
 * never silently dropped.
 *
 * `tomadoAt` absent defaults to the server's `now()` —
 * `MarcarDosisTomadaUseCase`, not this DTO, resolves that default and
 * rejects a future value (`domain/consumo.errors.ts`'s `DosisInvalidaError`
 * doc comment names the use case, not the DTO/controller layer, as the
 * thrower, so `Date.now()` is read at request-EXECUTION time, not at DTO
 * construction time).
 */
export class MarcarDosisDto {
  @ApiPropertyOptional({ example: '2026-08-10T12:30:00.000Z' })
  @IsOptional()
  @IsISO8601()
  tomadoAt?: string;
}
