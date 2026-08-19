import { NetworkError, getJson, postJson, postNoContent } from './api-json';
import type { AuthFetch } from './api-json';

// usuario-mobile-consumo design.md D-10: this is the shared JSON/error
// convention for every non-auth `authFetch` consumer (the 5 consumo
// screens). `authFetch` itself is stubbed directly — a plain jest.fn() —
// since `api-json.ts` only depends on its `(path, init?) => Promise<Response>`
// signature, not on `createAuthClient`'s internals.

function jsonResponse(status: number, body: unknown): Response {
  return { ok: status >= 200 && status < 300, status, json: () => Promise.resolve(body) } as unknown as Response;
}

function noBodyResponse(status: number): Response {
  return {
    ok: status >= 200 && status < 300,
    status,
    json: () => Promise.reject(new Error('Unexpected end of JSON input')),
  } as unknown as Response;
}

describe('getJson', () => {
  it('calls authFetch with the given path and no body/headers', async () => {
    const authFetch = jest.fn<ReturnType<AuthFetch>, Parameters<AuthFetch>>();
    authFetch.mockResolvedValue(jsonResponse(200, { id: '1' }));

    await getJson(authFetch, '/consumo/mis-mascotas');

    expect(authFetch).toHaveBeenCalledWith('/consumo/mis-mascotas', undefined);
  });

  it('resolves with the parsed JSON body on success', async () => {
    const authFetch = jest.fn<ReturnType<AuthFetch>, Parameters<AuthFetch>>();
    authFetch.mockResolvedValue(jsonResponse(200, { id: '1', nombre: 'Firulais' }));

    const result = await getJson(authFetch, '/consumo/mis-mascotas');

    expect(result).toEqual({ id: '1', nombre: 'Firulais' });
  });

  it('throws ApiError with the parsed statusCode/code/message on a non-2xx response', async () => {
    const authFetch = jest.fn<ReturnType<AuthFetch>, Parameters<AuthFetch>>();
    authFetch.mockResolvedValue(
      jsonResponse(404, { statusCode: 404, code: 'PET_NOT_FOUND', message: 'x' }),
    );

    await expect(getJson(authFetch, '/consumo/mis-mascotas')).rejects.toMatchObject({
      name: 'ApiError',
      statusCode: 404,
      code: 'PET_NOT_FOUND',
    });
  });

  it('falls back to UNKNOWN_ERROR/Unexpected error when the error body is unparseable', async () => {
    const authFetch = jest.fn<ReturnType<AuthFetch>, Parameters<AuthFetch>>();
    authFetch.mockResolvedValue(noBodyResponse(500));

    await expect(getJson(authFetch, '/consumo/mis-mascotas')).rejects.toMatchObject({
      code: 'UNKNOWN_ERROR',
      message: 'Unexpected error',
    });
  });

  it('a fetch/authFetch rejection becomes NetworkError, not the raw error', async () => {
    const authFetch = jest.fn<ReturnType<AuthFetch>, Parameters<AuthFetch>>();
    authFetch.mockRejectedValue(new TypeError('Failed to fetch'));

    await expect(getJson(authFetch, '/consumo/mis-mascotas')).rejects.toBeInstanceOf(NetworkError);
  });

  it("authFetch's own 'no active session' error propagates untouched — never wrapped as NetworkError", async () => {
    const authFetch = jest.fn<ReturnType<AuthFetch>, Parameters<AuthFetch>>();
    authFetch.mockRejectedValue(new Error('authFetch called with no active session'));

    await expect(getJson(authFetch, '/consumo/mis-mascotas')).rejects.toMatchObject({
      message: 'authFetch called with no active session',
    });
    await expect(getJson(authFetch, '/consumo/mis-mascotas')).rejects.not.toBeInstanceOf(NetworkError);
  });
});

describe('postJson', () => {
  it('sets Content-Type: application/json and JSON.stringifies the body', async () => {
    const authFetch = jest.fn<ReturnType<AuthFetch>, Parameters<AuthFetch>>();
    authFetch.mockResolvedValue(jsonResponse(201, { id: '1' }));

    await postJson(authFetch, '/consumo/mis-consumos', { nombre: 'Losartan' });

    expect(authFetch).toHaveBeenCalledWith('/consumo/mis-consumos', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ nombre: 'Losartan' }),
    });
  });

  it('resolves with the parsed JSON body on success', async () => {
    const authFetch = jest.fn<ReturnType<AuthFetch>, Parameters<AuthFetch>>();
    authFetch.mockResolvedValue(jsonResponse(201, { id: '1' }));

    const result = await postJson(authFetch, '/consumo/mis-consumos', {});

    expect(result).toEqual({ id: '1' });
  });

  it('throws ApiError on a non-2xx response, same shape as getJson', async () => {
    const authFetch = jest.fn<ReturnType<AuthFetch>, Parameters<AuthFetch>>();
    authFetch.mockResolvedValue(
      jsonResponse(400, { statusCode: 400, code: 'CONSUMO_INVALIDO', message: 'x' }),
    );

    await expect(postJson(authFetch, '/consumo/mis-consumos', {})).rejects.toMatchObject({
      code: 'CONSUMO_INVALIDO',
    });
  });
});

describe('postNoContent', () => {
  it('sets Content-Type and stringifies the body, defaulting to {} when omitted', async () => {
    const authFetch = jest.fn<ReturnType<AuthFetch>, Parameters<AuthFetch>>();
    authFetch.mockResolvedValue(noBodyResponse(204));

    await postNoContent(authFetch, '/consumo/mis-consumos/c-1/dosis');

    expect(authFetch).toHaveBeenCalledWith('/consumo/mis-consumos/c-1/dosis', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({}),
    });
  });

  it('never calls .json() on success — parsing an empty 204 body would throw', async () => {
    const authFetch = jest.fn<ReturnType<AuthFetch>, Parameters<AuthFetch>>();
    const response = noBodyResponse(204);
    const jsonSpy = jest.spyOn(response, 'json');
    authFetch.mockResolvedValue(response);

    await postNoContent(authFetch, '/consumo/mis-consumos/c-1/dosis');

    expect(jsonSpy).not.toHaveBeenCalled();
  });

  it('resolves void on 204', async () => {
    const authFetch = jest.fn<ReturnType<AuthFetch>, Parameters<AuthFetch>>();
    authFetch.mockResolvedValue(noBodyResponse(204));

    await expect(postNoContent(authFetch, '/consumo/mis-consumos/c-1/dosis')).resolves.toBeUndefined();
  });

  it('throws ApiError on a non-2xx response, parsing whatever body IS present', async () => {
    const authFetch = jest.fn<ReturnType<AuthFetch>, Parameters<AuthFetch>>();
    authFetch.mockResolvedValue(
      jsonResponse(400, { statusCode: 400, code: 'DOSIS_INVALIDA', message: 'x' }),
    );

    await expect(postNoContent(authFetch, '/consumo/mis-consumos/c-1/dosis')).rejects.toMatchObject({
      code: 'DOSIS_INVALIDA',
    });
  });
});

describe('NetworkError', () => {
  it('always carries code RED_NO_DISPONIBLE', () => {
    expect(new NetworkError().code).toBe('RED_NO_DISPONIBLE');
  });
});
