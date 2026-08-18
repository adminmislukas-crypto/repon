import { EmpresaSuspendidaError, PerfilSuspendidoError, RolNoPermitidoError } from './identidad.errors';
import { assertSesionPermitida } from './sesion-elegibilidad';

describe('assertSesionPermitida', () => {
  it('passes for an active user with no company', () => {
    expect(() =>
      assertSesionPermitida({ role: 'user', status: 'activo', companyStatus: null }),
    ).not.toThrow();
  });

  it('passes for an active provider with an active company', () => {
    expect(() =>
      assertSesionPermitida({ role: 'provider', status: 'activo', companyStatus: 'activo' }),
    ).not.toThrow();
  });

  it('passes for an active provider with a pending company — pending is success, per spec', () => {
    expect(() =>
      assertSesionPermitida({ role: 'provider', status: 'activo', companyStatus: 'pendiente' }),
    ).not.toThrow();
  });

  it('passes for an active admin', () => {
    expect(() =>
      assertSesionPermitida({ role: 'admin', status: 'activo', companyStatus: null }),
    ).not.toThrow();
  });

  it('throws PerfilSuspendidoError for a suspended user', () => {
    expect(() =>
      assertSesionPermitida({ role: 'user', status: 'suspendido', companyStatus: null }),
    ).toThrow(PerfilSuspendidoError);
  });

  it('throws PerfilSuspendidoError for a suspended provider, regardless of companyStatus', () => {
    expect(() =>
      assertSesionPermitida({ role: 'provider', status: 'suspendido', companyStatus: 'activo' }),
    ).toThrow(PerfilSuspendidoError);
  });

  it('throws PerfilSuspendidoError for a suspended admin', () => {
    expect(() =>
      assertSesionPermitida({ role: 'admin', status: 'suspendido', companyStatus: null }),
    ).toThrow(PerfilSuspendidoError);
  });

  it('throws EmpresaSuspendidaError for an active provider with a suspended company', () => {
    expect(() =>
      assertSesionPermitida({ role: 'provider', status: 'activo', companyStatus: 'suspendido' }),
    ).toThrow(EmpresaSuspendidaError);
  });

  it('does not apply the companyStatus check to a non-provider role, even if companyStatus is suspendido', () => {
    expect(() =>
      assertSesionPermitida({ role: 'user', status: 'activo', companyStatus: 'suspendido' }),
    ).not.toThrow();
  });

  it('refuses a suspended profile before a role mismatch is even evaluated', () => {
    expect(() =>
      assertSesionPermitida({
        role: 'user',
        status: 'suspendido',
        companyStatus: null,
        expectedRole: 'provider',
      }),
    ).toThrow(PerfilSuspendidoError);
  });

  it('refuses a suspended company before a role mismatch is even evaluated', () => {
    expect(() =>
      assertSesionPermitida({
        role: 'provider',
        status: 'activo',
        companyStatus: 'suspendido',
        expectedRole: 'user',
      }),
    ).toThrow(EmpresaSuspendidaError);
  });

  it('throws RolNoPermitidoError when expectedRole does not match the resolved role', () => {
    expect(() =>
      assertSesionPermitida({
        role: 'user',
        status: 'activo',
        companyStatus: null,
        expectedRole: 'provider',
      }),
    ).toThrow(RolNoPermitidoError);
  });

  it('throws RolNoPermitidoError for an admin credential against either app', () => {
    expect(() =>
      assertSesionPermitida({ role: 'admin', status: 'activo', companyStatus: null, expectedRole: 'user' }),
    ).toThrow(RolNoPermitidoError);
    expect(() =>
      assertSesionPermitida({
        role: 'admin',
        status: 'activo',
        companyStatus: null,
        expectedRole: 'provider',
      }),
    ).toThrow(RolNoPermitidoError);
  });

  it('passes when expectedRole matches the resolved role', () => {
    expect(() =>
      assertSesionPermitida({
        role: 'provider',
        status: 'activo',
        companyStatus: 'activo',
        expectedRole: 'provider',
      }),
    ).not.toThrow();
  });

  it('passes when expectedRole is omitted entirely', () => {
    expect(() =>
      assertSesionPermitida({ role: 'user', status: 'activo', companyStatus: null }),
    ).not.toThrow();
  });
});
