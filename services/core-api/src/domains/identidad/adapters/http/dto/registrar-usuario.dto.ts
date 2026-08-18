import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';
import { IsEmail, IsIn, IsOptional, IsString, IsUUID, MinLength } from 'class-validator';

/**
 * `POST /identidad/usuarios` is `@Public()` (design.md's HTTP surface
 * table) — deliberately excludes `'admin'` from the accepted `role`
 * values, unlike `RegistrarUsuarioCommand.role: Role` (which accepts all
 * 3). An anonymous, unauthenticated caller must never be able to
 * self-assign `role: 'admin'` on a `Profile`; `core-api-identidad` spec's
 * HTTP surface table doesn't restate this restriction explicitly for this
 * route, so this is a DTO-level defense-in-depth choice flagged for
 * reviewer visibility, not a silent narrowing of the use case's own
 * contract (`asignarRolAdmin`, admin-only, is the only path that grants
 * actual admin authority via `admin_roles`; a self-registered `role:
 * 'admin'` profile with no `admin_roles` row would still be blocked by
 * `RolesGuard`'s `ADMIN_SUBROLE_MISSING` on every `@AdminRoles()` route in
 * this change today — this restriction is belt-and-suspenders, not the
 * only gate).
 */
export const SELF_SERVICE_ROLES = ['user', 'provider'] as const;
export type SelfServiceRole = (typeof SELF_SERVICE_ROLES)[number];

export class RegistrarUsuarioDto {
  @ApiProperty({ example: 'ana@proveedora.cl' })
  @IsEmail()
  email!: string;

  // No password policy is documented anywhere in this change's specs;
  // `MinLength(8)` is a pragmatic DTO-level default, not sourced from a
  // spec — flagged for reviewer visibility.
  @ApiProperty({ minLength: 8, writeOnly: true })
  @IsString()
  @MinLength(8)
  password!: string;

  @ApiProperty({ example: 'Ana Pérez' })
  @IsString()
  nombre!: string;

  @ApiPropertyOptional({ example: '+56912345678' })
  @IsOptional()
  @IsString()
  telefono?: string;

  @ApiProperty({ enum: SELF_SERVICE_ROLES })
  @IsIn(SELF_SERVICE_ROLES)
  role!: SelfServiceRole;

  /**
   * Required iff `role === 'provider'` — enforced by the domain
   * (`assertProviderHasCompany`, `InvalidProfileError` -> 400 via
   * `IdentidadExceptionFilter`), not duplicated here as a conditional
   * class-validator rule.
   */
  @ApiPropertyOptional({ format: 'uuid' })
  @IsOptional()
  @IsUUID()
  companyId?: string;
}
