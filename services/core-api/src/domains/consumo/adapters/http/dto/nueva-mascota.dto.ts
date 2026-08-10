import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';
import { IsNotEmpty, IsNumber, IsOptional, IsString, Min } from 'class-validator';

/**
 * `POST /consumo/mis-mascotas` body. Mirrors `RegistrarMascotaUseCase`'s
 * `NuevaMascotaInput` field-for-field, with deliberately NO `userId` field
 * (D8, core-api-consumo spec: "the DTO for these routes has no userId
 * field") — the only `userId` reaching the use case is `actor.profileId`,
 * derived by the controller; there is nothing in this body to trust or
 * ignore. Combined with `main.ts`'s global `ValidationPipe({ whitelist:
 * true, forbidNonWhitelisted: true })`, a client-supplied `userId` in the
 * request body is rejected with 400, never silently dropped.
 *
 * Field-level validation mirrors `domain/pet.entity.ts`'s `crear()`
 * invariants (non-empty `nombre`/`especie`) plus basic shape checks for the
 * optional fields — the entity is still the single source of truth for the
 * invariant itself (never trusted away here).
 */
export class NuevaMascotaDto {
  @ApiProperty({ example: 'Firulais' })
  @IsString()
  @IsNotEmpty()
  nombre!: string;

  @ApiProperty({ example: 'perro' })
  @IsString()
  @IsNotEmpty()
  especie!: string;

  @ApiPropertyOptional({ example: 'Labrador' })
  @IsOptional()
  @IsString()
  raza?: string;

  @ApiPropertyOptional({ example: 25.5 })
  @IsOptional()
  @IsNumber()
  @Min(0)
  pesoKg?: number;
}
