import { ApiProperty } from '@nestjs/swagger';
import { IsNotEmpty, IsString } from 'class-validator';

/**
 * `reactivarEmpresa`'s request body — one `motivo`, structurally identical
 * to `SuspensionDto` (D-D, `backend-core-api-catalogo`). Deliberately NOT a
 * reuse of `SuspensionDto`: this is a security-sensitive boundary
 * (suspend vs. reactivate), and a shared DTO named after suspension would
 * make the two routes' request bodies accidentally interchangeable at the
 * type level for no real gain — 6 duplicated lines is cheaper than that
 * coupling, and cheaper than touching `identidad-dto.spec.ts`'s existing,
 * green `SuspensionDto` tests to accommodate a second use.
 */
export class ReactivacionDto {
  @ApiProperty({ example: 'Cumplió con el plan de mejora' })
  @IsString()
  @IsNotEmpty()
  motivo!: string;
}
