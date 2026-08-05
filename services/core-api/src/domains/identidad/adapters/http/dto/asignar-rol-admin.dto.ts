import { ApiProperty } from '@nestjs/swagger';
import { IsIn } from 'class-validator';
import type { AdminRole } from '@repon/types';

const ADMIN_ROLES: AdminRole[] = ['super_admin', 'soporte', 'finanzas'];

/** `PUT /identidad/usuarios/:id/rol-admin` — `@AdminRoles('super_admin')` only (privilege escalation). */
export class AsignarRolAdminDto {
  @ApiProperty({ enum: ADMIN_ROLES })
  @IsIn(ADMIN_ROLES)
  rol!: AdminRole;
}
