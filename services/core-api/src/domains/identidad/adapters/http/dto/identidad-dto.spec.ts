import { plainToInstance } from 'class-transformer';
import { validate, type ValidationError } from 'class-validator';
import { AsignarRolAdminDto } from './asignar-rol-admin.dto';
import { RegistrarEmpresaDto } from './registrar-empresa.dto';
import { RegistrarUsuarioDto } from './registrar-usuario.dto';
import { SuspensionDto } from './suspension.dto';

// `main.ts`'s global `ValidationPipe` runs `class-validator` with
// `whitelist: true, forbidNonWhitelisted: true` — mirrored here directly
// (not through the full Nest pipe) so these stay fast, DI-free unit tests
// (`test:unit`, not `test:e2e`). `test/identidad.e2e-spec.ts` proves the
// same behavior through the real HTTP pipeline for at least one route.
const STRICT_OPTIONS = { whitelist: true, forbidNonWhitelisted: true };

function hasConstraint(errors: ValidationError[], property: string): boolean {
  return errors.some((error) => error.property === property);
}

describe('RegistrarUsuarioDto', () => {
  const valid = {
    email: 'ana@proveedora.cl',
    password: 'super-secret-1',
    nombre: 'Ana Pérez',
    role: 'user',
  };

  it('accepts a valid self-service payload with role: user', async () => {
    const dto = plainToInstance(RegistrarUsuarioDto, valid);
    expect(await validate(dto, STRICT_OPTIONS)).toHaveLength(0);
  });

  it('accepts role: provider with a companyId', async () => {
    const dto = plainToInstance(RegistrarUsuarioDto, {
      ...valid,
      role: 'provider',
      companyId: '11111111-1111-4111-8111-111111111111',
    });
    expect(await validate(dto, STRICT_OPTIONS)).toHaveLength(0);
  });

  it('rejects an invalid email', async () => {
    const dto = plainToInstance(RegistrarUsuarioDto, { ...valid, email: 'not-an-email' });
    expect(hasConstraint(await validate(dto, STRICT_OPTIONS), 'email')).toBe(true);
  });

  it('rejects a password shorter than the minimum', async () => {
    const dto = plainToInstance(RegistrarUsuarioDto, { ...valid, password: 'short' });
    expect(hasConstraint(await validate(dto, STRICT_OPTIONS), 'password')).toBe(true);
  });

  it('rejects role: admin — self-service registration MUST NOT grant admin (defense in depth)', async () => {
    const dto = plainToInstance(RegistrarUsuarioDto, { ...valid, role: 'admin' });
    expect(hasConstraint(await validate(dto, STRICT_OPTIONS), 'role')).toBe(true);
  });

  it('rejects an unknown extra field (mirrors main.ts forbidNonWhitelisted)', async () => {
    const dto = plainToInstance(RegistrarUsuarioDto, { ...valid, isAdmin: true });
    expect(hasConstraint(await validate(dto, STRICT_OPTIONS), 'isAdmin')).toBe(true);
  });
});

describe('RegistrarEmpresaDto', () => {
  const valid = { razonSocial: 'Proveedora SPA', rut: '76.123.456-7', giro: 'Distribución' };

  it('accepts a valid payload', async () => {
    const dto = plainToInstance(RegistrarEmpresaDto, valid);
    expect(await validate(dto, STRICT_OPTIONS)).toHaveLength(0);
  });

  it('rejects a missing required field', async () => {
    const { rut: _rut, ...withoutRut } = valid;
    const dto = plainToInstance(RegistrarEmpresaDto, withoutRut);
    expect(hasConstraint(await validate(dto, STRICT_OPTIONS), 'rut')).toBe(true);
  });
});

describe('SuspensionDto', () => {
  it('accepts a non-empty motivo', async () => {
    const dto = plainToInstance(SuspensionDto, { motivo: 'Incumplimiento' });
    expect(await validate(dto, STRICT_OPTIONS)).toHaveLength(0);
  });

  it('rejects an empty motivo', async () => {
    const dto = plainToInstance(SuspensionDto, { motivo: '' });
    expect(hasConstraint(await validate(dto, STRICT_OPTIONS), 'motivo')).toBe(true);
  });
});

describe('AsignarRolAdminDto', () => {
  it('accepts a valid AdminRole', async () => {
    const dto = plainToInstance(AsignarRolAdminDto, { rol: 'soporte' });
    expect(await validate(dto, STRICT_OPTIONS)).toHaveLength(0);
  });

  it('rejects a value outside the AdminRole union', async () => {
    const dto = plainToInstance(AsignarRolAdminDto, { rol: 'not-a-role' });
    expect(hasConstraint(await validate(dto, STRICT_OPTIONS), 'rol')).toBe(true);
  });
});
