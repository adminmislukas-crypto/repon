import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';
import { IsEmail, IsIn, IsNotEmpty, IsOptional, IsString } from 'class-validator';
import { SELF_SERVICE_ROLES, type SelfServiceRole } from './registrar-usuario.dto';

export class IniciarSesionDto {
  @ApiProperty({ example: 'ana@proveedora.cl' })
  @IsEmail()
  email!: string;

  // Deliberately NO @MinLength (unlike RegistrarUsuarioDto's password) —
  // mobile-auth-login design.md D-2: a length rule on login would turn a
  // short-password guess into a distinguishable 400 while a wrong-but-long
  // one is a 401, leaking the password policy and violating "wrong
  // password and unknown email are indistinguishable" (spec).
  @ApiProperty({ writeOnly: true })
  @IsString()
  @IsNotEmpty()
  password!: string;

  /**
   * UX-only role gate (design.md D-5) — never the security boundary
   * (`AuthGuard`/`RolesGuard` remain that, unchanged). Optional: the client
   * may omit it, in which case no role-mismatch check runs at all
   * (`domain/sesion-elegibilidad.ts`).
   */
  @ApiPropertyOptional({ enum: SELF_SERVICE_ROLES })
  @IsOptional()
  @IsIn(SELF_SERVICE_ROLES)
  expectedRole?: SelfServiceRole;
}
