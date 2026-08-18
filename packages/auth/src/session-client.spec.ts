import type { AuthConfig } from './config';
import { SesionApiError, cerrarSesion, iniciarSesion, refrescarSesion } from './session-client';

const config: AuthConfig = { apiBaseUrl: 'https://api.example.com', expectedRole: 'user' };

const successBody = {
  accessToken: 'access-1',
  refreshToken: 'refresh-1',
  tokenType: 'bearer' as const,
  expiresAt: 1_700_000_000,
  perfil: { id: 'p1', role: 'user' as const, status: 'activo' as const, nombre: 'Ana', email: 'ana@example.com' },
};

function jsonResponse(status: number, body: unknown): Response {
  return {
    ok: status >= 200 && status < 300,
    status,
    json: () => Promise.resolve(body),
  } as unknown as Response;
}

describe('session-client', () => {
  let fetchSpy: jest.SpiedFunction<typeof fetch>;

  beforeEach(() => {
    fetchSpy = jest.spyOn(globalThis, 'fetch');
  });

  afterEach(() => {
    fetchSpy.mockRestore();
  });

  describe('iniciarSesion', () => {
    it('POSTs to /identidad/sesion with email, password, and expectedRole', async () => {
      fetchSpy.mockResolvedValue(jsonResponse(200, successBody));

      await iniciarSesion(config, 'ana@example.com', 'secret');

      expect(fetchSpy).toHaveBeenCalledWith(
        'https://api.example.com/identidad/sesion',
        expect.objectContaining({
          method: 'POST',
          headers: expect.objectContaining({ 'Content-Type': 'application/json' }),
          body: JSON.stringify({ email: 'ana@example.com', password: 'secret', expectedRole: 'user' }),
        }),
      );
    });

    it('maps a successful response to a Sesion, dropping tokenType', async () => {
      fetchSpy.mockResolvedValue(jsonResponse(200, successBody));

      const sesion = await iniciarSesion(config, 'ana@example.com', 'secret');

      expect(sesion).toEqual({
        accessToken: 'access-1',
        refreshToken: 'refresh-1',
        expiresAt: 1_700_000_000,
        perfil: successBody.perfil,
        companyStatus: undefined,
      });
    });

    it('throws a SesionApiError carrying the exact statusCode/code/message on failure', async () => {
      fetchSpy.mockResolvedValue(
        jsonResponse(401, { statusCode: 401, code: 'CREDENCIALES_INVALIDAS', message: 'Credenciales inválidas.' }),
      );

      await expect(iniciarSesion(config, 'ana@example.com', 'wrong')).rejects.toMatchObject({
        statusCode: 401,
        code: 'CREDENCIALES_INVALIDAS',
        message: 'Credenciales inválidas.',
      });
    });

    it('throws a SesionApiError instance specifically', async () => {
      fetchSpy.mockResolvedValue(jsonResponse(503, { statusCode: 503, code: 'AUTH_PROVIDER_NO_DISPONIBLE', message: 'x' }));

      await expect(iniciarSesion(config, 'a@b.cl', 'x')).rejects.toBeInstanceOf(SesionApiError);
    });
  });

  describe('refrescarSesion', () => {
    it('POSTs to /identidad/sesion/refresco with the refresh token', async () => {
      fetchSpy.mockResolvedValue(jsonResponse(200, successBody));

      await refrescarSesion(config, 'old-refresh-token');

      expect(fetchSpy).toHaveBeenCalledWith(
        'https://api.example.com/identidad/sesion/refresco',
        expect.objectContaining({
          method: 'POST',
          body: JSON.stringify({ refreshToken: 'old-refresh-token' }),
        }),
      );
    });

    it('maps a successful response to a Sesion', async () => {
      fetchSpy.mockResolvedValue(jsonResponse(200, successBody));

      await expect(refrescarSesion(config, 'old-refresh-token')).resolves.toMatchObject({
        accessToken: 'access-1',
      });
    });

    it('throws SesionApiError(401, SESION_EXPIRADA) on a stale token', async () => {
      fetchSpy.mockResolvedValue(
        jsonResponse(401, { statusCode: 401, code: 'SESION_EXPIRADA', message: 'La sesión ha expirado.' }),
      );

      await expect(refrescarSesion(config, 'stale-token')).rejects.toMatchObject({
        statusCode: 401,
        code: 'SESION_EXPIRADA',
      });
    });
  });

  describe('cerrarSesion', () => {
    it('DELETEs /identidad/sesion with the bearer token', async () => {
      fetchSpy.mockResolvedValue({ ok: true, status: 204, json: () => Promise.resolve(null) } as unknown as Response);

      await cerrarSesion(config, 'access-1');

      expect(fetchSpy).toHaveBeenCalledWith(
        'https://api.example.com/identidad/sesion',
        expect.objectContaining({
          method: 'DELETE',
          headers: expect.objectContaining({ Authorization: 'Bearer access-1' }),
        }),
      );
    });

    it('resolves without a body on 204', async () => {
      fetchSpy.mockResolvedValue({ ok: true, status: 204, json: () => Promise.resolve(null) } as unknown as Response);

      await expect(cerrarSesion(config, 'access-1')).resolves.toBeUndefined();
    });

    it('propagates a SesionApiError on failure — swallowing is the caller\'s job, not this layer\'s', async () => {
      fetchSpy.mockResolvedValue(
        jsonResponse(401, { statusCode: 401, code: 'MISSING_BEARER_TOKEN', message: 'x' }),
      );

      await expect(cerrarSesion(config, 'bad-token')).rejects.toBeInstanceOf(SesionApiError);
    });
  });
});
