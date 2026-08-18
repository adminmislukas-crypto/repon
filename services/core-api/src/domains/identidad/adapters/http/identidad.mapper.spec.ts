import type { Company, Profile } from '@repon/types';
import type { SesionResult } from '../../ports-in/iniciar-sesion.use-case';
import { RegistrarEmpresaDto } from './dto/registrar-empresa.dto';
import { RegistrarUsuarioDto } from './dto/registrar-usuario.dto';
import {
  toCompanyResponseDto,
  toProfileResponseDto,
  toRegistrarEmpresaCommand,
  toRegistrarUsuarioCommand,
  toSesionResponseDto,
} from './identidad.mapper';

describe('identidad.mapper', () => {
  it('toRegistrarUsuarioCommand carries every DTO field through, including optionals', () => {
    const dto = new RegistrarUsuarioDto();
    Object.assign(dto, {
      email: 'ana@proveedora.cl',
      password: 'super-secret-1',
      nombre: 'Ana Pérez',
      telefono: '+56912345678',
      role: 'provider',
      companyId: '11111111-1111-1111-1111-111111111111',
    });

    expect(toRegistrarUsuarioCommand(dto)).toEqual({
      email: 'ana@proveedora.cl',
      password: 'super-secret-1',
      nombre: 'Ana Pérez',
      telefono: '+56912345678',
      role: 'provider',
      companyId: '11111111-1111-1111-1111-111111111111',
    });
  });

  it('toRegistrarUsuarioCommand omits absent optionals rather than inventing null', () => {
    const dto = new RegistrarUsuarioDto();
    Object.assign(dto, { email: 'x@y.cl', password: 'super-secret-1', nombre: 'X', role: 'user' });

    const command = toRegistrarUsuarioCommand(dto);

    expect(command.telefono).toBeUndefined();
    expect(command.companyId).toBeUndefined();
  });

  it('toProfileResponseDto maps every Profile field 1:1', () => {
    const profile: Profile = {
      id: 'p1',
      role: 'user',
      status: 'activo',
      nombre: 'Ana',
      email: 'ana@x.cl',
      telefono: '+56900000000',
    };

    expect(toProfileResponseDto(profile)).toEqual(profile);
  });

  it('toRegistrarEmpresaCommand carries every DTO field through', () => {
    const dto = new RegistrarEmpresaDto();
    Object.assign(dto, {
      razonSocial: 'Proveedora SPA',
      rut: '76.123.456-7',
      giro: 'Distribución',
    });

    expect(toRegistrarEmpresaCommand(dto)).toEqual({
      razonSocial: 'Proveedora SPA',
      rut: '76.123.456-7',
      giro: 'Distribución',
    });
  });

  it('toCompanyResponseDto maps every Company field 1:1', () => {
    const company: Company = {
      id: 'c1',
      razonSocial: 'Proveedora SPA',
      rut: '76.123.456-7',
      giro: 'Distribución',
      status: 'pendiente',
    };

    expect(toCompanyResponseDto(company)).toEqual(company);
  });

  it('toSesionResponseDto maps every field, adds tokenType: bearer, and reuses toProfileResponseDto', () => {
    const result: SesionResult = {
      accessToken: 'access-1',
      refreshToken: 'refresh-1',
      expiresAt: 1_700_000_000,
      perfil: { id: 'p1', role: 'provider', status: 'activo', nombre: 'P', email: 'p@x.cl', companyId: 'co-1' },
      companyStatus: 'pendiente',
    };

    expect(toSesionResponseDto(result)).toEqual({
      accessToken: 'access-1',
      refreshToken: 'refresh-1',
      tokenType: 'bearer',
      expiresAt: 1_700_000_000,
      perfil: toProfileResponseDto(result.perfil),
      companyStatus: 'pendiente',
    });
  });

  it('toSesionResponseDto omits companyStatus rather than inventing null for a user', () => {
    const result: SesionResult = {
      accessToken: 'access-1',
      refreshToken: 'refresh-1',
      expiresAt: 1_700_000_000,
      perfil: { id: 'p1', role: 'user', status: 'activo', nombre: 'U', email: 'u@x.cl' },
      companyStatus: null,
    };

    expect(toSesionResponseDto(result).companyStatus).toBeUndefined();
  });
});
