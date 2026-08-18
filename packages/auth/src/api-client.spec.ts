jest.mock('./session-client', () => ({
  refrescarSesion: jest.fn(),
}));
jest.mock('./session-storage', () => ({
  loadSession: jest.fn(),
  saveSession: jest.fn(),
  clearSession: jest.fn(),
}));

import { createAuthClient } from './api-client';
import type { AuthConfig } from './config';
import { refrescarSesion } from './session-client';
import { clearSession, loadSession, saveSession } from './session-storage';
import type { Sesion } from './session.types';

const config: AuthConfig = { apiBaseUrl: 'https://api.example.com', expectedRole: 'user' };

function buildSesion(overrides: Partial<Sesion> = {}): Sesion {
  const now = Math.floor(Date.now() / 1000);
  return {
    accessToken: 'access-1',
    refreshToken: 'refresh-1',
    expiresAt: now + 3600,
    perfil: { id: 'p1', role: 'user', status: 'activo', nombre: 'Ana', email: 'ana@example.com' },
    ...overrides,
  };
}

function jsonResponse(status: number): Response {
  return { ok: status >= 200 && status < 300, status } as unknown as Response;
}

describe('createAuthClient — authFetch', () => {
  let fetchSpy: jest.SpiedFunction<typeof fetch>;
  const mockedLoadSession = loadSession as jest.Mock;
  const mockedSaveSession = saveSession as jest.Mock;
  const mockedClearSession = clearSession as jest.Mock;
  const mockedRefrescarSesion = refrescarSesion as jest.Mock;

  beforeEach(() => {
    fetchSpy = jest.spyOn(globalThis, 'fetch');
    jest.clearAllMocks();
  });

  afterEach(() => {
    fetchSpy.mockRestore();
  });

  it('attaches the current session as a Bearer header', async () => {
    mockedLoadSession.mockResolvedValue(buildSesion());
    fetchSpy.mockResolvedValue(jsonResponse(200));

    const client = createAuthClient(config);
    await client.authFetch('/catalogo/productos');

    expect(fetchSpy).toHaveBeenCalledWith(
      'https://api.example.com/catalogo/productos',
      expect.objectContaining({ headers: expect.objectContaining({ Authorization: 'Bearer access-1' }) }),
    );
  });

  it('proactively refreshes when expiresAt is under 60s away, before issuing the request', async () => {
    const now = Math.floor(Date.now() / 1000);
    mockedLoadSession.mockResolvedValue(buildSesion({ expiresAt: now + 30 }));
    const refreshed = buildSesion({ accessToken: 'access-2' });
    mockedRefrescarSesion.mockResolvedValue(refreshed);
    fetchSpy.mockResolvedValue(jsonResponse(200));

    const client = createAuthClient(config);
    await client.authFetch('/catalogo/productos');

    expect(mockedRefrescarSesion).toHaveBeenCalledTimes(1);
    expect(fetchSpy).toHaveBeenCalledWith(
      'https://api.example.com/catalogo/productos',
      expect.objectContaining({ headers: expect.objectContaining({ Authorization: 'Bearer access-2' }) }),
    );
  });

  it('does not refresh when the session is comfortably valid', async () => {
    mockedLoadSession.mockResolvedValue(buildSesion());
    fetchSpy.mockResolvedValue(jsonResponse(200));

    const client = createAuthClient(config);
    await client.authFetch('/catalogo/productos');

    expect(mockedRefrescarSesion).not.toHaveBeenCalled();
  });

  it('rotation persists atomically — a refreshed session is fully saved before the retried request goes out', async () => {
    mockedLoadSession.mockResolvedValue(buildSesion());
    const refreshed = buildSesion({ accessToken: 'access-2', refreshToken: 'refresh-2' });
    mockedRefrescarSesion.mockResolvedValue(refreshed);
    fetchSpy.mockResolvedValueOnce(jsonResponse(401)).mockResolvedValueOnce(jsonResponse(200));

    const client = createAuthClient(config);
    await client.authFetch('/catalogo/productos');

    expect(mockedSaveSession).toHaveBeenCalledWith(refreshed);
    expect(mockedSaveSession).toHaveBeenCalledTimes(1);
  });

  it('a 401 triggers exactly one retry with the refreshed token', async () => {
    mockedLoadSession.mockResolvedValue(buildSesion());
    mockedRefrescarSesion.mockResolvedValue(buildSesion({ accessToken: 'access-2' }));
    fetchSpy.mockResolvedValueOnce(jsonResponse(401)).mockResolvedValueOnce(jsonResponse(200));

    const client = createAuthClient(config);
    const response = await client.authFetch('/catalogo/productos');

    expect(response.status).toBe(200);
    expect(fetchSpy).toHaveBeenCalledTimes(2);
    expect(fetchSpy).toHaveBeenNthCalledWith(
      2,
      'https://api.example.com/catalogo/productos',
      expect.objectContaining({ headers: expect.objectContaining({ Authorization: 'Bearer access-2' }) }),
    );
  });

  it('a second 401 (after the retry) signs out and never attempts a third request', async () => {
    mockedLoadSession.mockResolvedValue(buildSesion());
    mockedRefrescarSesion.mockResolvedValue(buildSesion({ accessToken: 'access-2' }));
    fetchSpy.mockResolvedValueOnce(jsonResponse(401)).mockResolvedValueOnce(jsonResponse(401));

    const client = createAuthClient(config);
    const response = await client.authFetch('/catalogo/productos');

    expect(response.status).toBe(401);
    expect(fetchSpy).toHaveBeenCalledTimes(2);
    expect(mockedClearSession).toHaveBeenCalledTimes(1);
  });

  it('a failed refresh (on a 401) signs out and returns the original 401 without retrying', async () => {
    mockedLoadSession.mockResolvedValue(buildSesion());
    mockedRefrescarSesion.mockRejectedValue(new Error('refresh token expired'));
    fetchSpy.mockResolvedValueOnce(jsonResponse(401));

    const client = createAuthClient(config);
    const response = await client.authFetch('/catalogo/productos');

    expect(response.status).toBe(401);
    expect(fetchSpy).toHaveBeenCalledTimes(1);
    expect(mockedClearSession).toHaveBeenCalledTimes(1);
  });

  it('a 403 never triggers a refresh or a retry', async () => {
    mockedLoadSession.mockResolvedValue(buildSesion());
    fetchSpy.mockResolvedValueOnce(jsonResponse(403));

    const client = createAuthClient(config);
    const response = await client.authFetch('/identidad/algo');

    expect(response.status).toBe(403);
    expect(fetchSpy).toHaveBeenCalledTimes(1);
    expect(mockedRefrescarSesion).not.toHaveBeenCalled();
    expect(mockedClearSession).not.toHaveBeenCalled();
  });

  it('refresh single-flights under concurrent calls — two simultaneous requests needing a refresh trigger exactly one refrescarSesion call', async () => {
    const now = Math.floor(Date.now() / 1000);
    mockedLoadSession.mockResolvedValue(buildSesion({ expiresAt: now + 10 }));
    let resolveRefresh!: (sesion: Sesion) => void;
    mockedRefrescarSesion.mockImplementation(
      () =>
        new Promise<Sesion>((resolve) => {
          resolveRefresh = resolve;
        }),
    );
    fetchSpy.mockResolvedValue(jsonResponse(200));

    const client = createAuthClient(config);
    const first = client.authFetch('/a');
    const second = client.authFetch('/b');

    // Let both calls reach the refresh gate before resolving it.
    await Promise.resolve();
    await Promise.resolve();
    resolveRefresh(buildSesion({ accessToken: 'access-2' }));

    await Promise.all([first, second]);

    expect(mockedRefrescarSesion).toHaveBeenCalledTimes(1);
  });

  it('throws when authFetch is called with no active session', async () => {
    mockedLoadSession.mockResolvedValue(null);

    const client = createAuthClient(config);

    await expect(client.authFetch('/catalogo/productos')).rejects.toThrow();
    expect(fetchSpy).not.toHaveBeenCalled();
  });

  it('notifies onSessionChange with the refreshed session', async () => {
    mockedLoadSession.mockResolvedValue(buildSesion());
    const refreshed = buildSesion({ accessToken: 'access-2' });
    mockedRefrescarSesion.mockResolvedValue(refreshed);
    fetchSpy.mockResolvedValueOnce(jsonResponse(401)).mockResolvedValueOnce(jsonResponse(200));
    const onSessionChange = jest.fn();

    const client = createAuthClient(config, { onSessionChange });
    await client.authFetch('/catalogo/productos');

    expect(onSessionChange).toHaveBeenCalledWith(refreshed);
  });

  it('notifies onSessionChange with null on sign-out', async () => {
    mockedLoadSession.mockResolvedValue(buildSesion());
    mockedRefrescarSesion.mockRejectedValue(new Error('expired'));
    fetchSpy.mockResolvedValueOnce(jsonResponse(401));
    const onSessionChange = jest.fn();

    const client = createAuthClient(config, { onSessionChange });
    await client.authFetch('/catalogo/productos');

    expect(onSessionChange).toHaveBeenCalledWith(null);
  });
});
