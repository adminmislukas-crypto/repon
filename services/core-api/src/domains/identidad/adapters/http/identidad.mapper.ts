import type { Company, Profile } from '@repon/types';
import type { RegistrarEmpresaCommand } from '../../ports-in/registrar-empresa.use-case';
import type { RegistrarUsuarioCommand } from '../../ports-in/registrar-usuario.use-case';
import type { SesionResult } from '../../ports-in/iniciar-sesion.use-case';
import type { CompanyResponseDto } from './dto/company-response.dto';
import type { ProfileResponseDto } from './dto/profile-response.dto';
import type { RegistrarEmpresaDto } from './dto/registrar-empresa.dto';
import type { RegistrarUsuarioDto } from './dto/registrar-usuario.dto';
import type { SesionResponseDto } from './dto/sesion-response.dto';

/**
 * `core-api-hexagonal-layout` spec, "DTOs and framework decorators stay in
 * adapters/http": the thin DTO<->port-argument and entity<->response-DTO
 * conversion, kept free of business logic — that already lives in the 6
 * use cases (ports-in).
 */
export function toRegistrarUsuarioCommand(dto: RegistrarUsuarioDto): RegistrarUsuarioCommand {
  return {
    email: dto.email,
    password: dto.password,
    nombre: dto.nombre,
    telefono: dto.telefono,
    role: dto.role,
    companyId: dto.companyId,
  };
}

export function toProfileResponseDto(profile: Profile): ProfileResponseDto {
  return {
    id: profile.id,
    role: profile.role,
    status: profile.status,
    nombre: profile.nombre,
    email: profile.email,
    telefono: profile.telefono,
    companyId: profile.companyId,
  };
}

export function toRegistrarEmpresaCommand(dto: RegistrarEmpresaDto): RegistrarEmpresaCommand {
  return {
    razonSocial: dto.razonSocial,
    rut: dto.rut,
    giro: dto.giro,
  };
}

export function toCompanyResponseDto(company: Company): CompanyResponseDto {
  return {
    id: company.id,
    razonSocial: company.razonSocial,
    rut: company.rut,
    giro: company.giro,
    status: company.status,
  };
}

/** Reuses `toProfileResponseDto` (design.md D-2 task 9.4) — one profile-shape mapping, everywhere it's returned. */
export function toSesionResponseDto(result: SesionResult): SesionResponseDto {
  return {
    accessToken: result.accessToken,
    refreshToken: result.refreshToken,
    tokenType: 'bearer',
    expiresAt: result.expiresAt,
    perfil: toProfileResponseDto(result.perfil),
    companyStatus: result.companyStatus ?? undefined,
  };
}
