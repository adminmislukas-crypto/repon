import type { SupabaseClient } from '@supabase/supabase-js';
import { GoTrueAuthClient } from './gotrue-auth.client';

function mockResponse(status: number, body: unknown): Response {
  return {
    ok: status >= 200 && status < 300,
    status,
    json: () => Promise.resolve(body),
  } as unknown as Response;
}

describe('GoTrueAuthClient', () => {
  const supabaseUrl = 'http://127.0.0.1:54321';
  const anonKey = 'anon-key-value';
  let signOut: jest.Mock;
  let supabaseClient: SupabaseClient;
  let fetchSpy: jest.SpiedFunction<typeof fetch>;

  beforeEach(() => {
    signOut = jest.fn().mockResolvedValue({ error: null });
    supabaseClient = { auth: { admin: { signOut } } } as unknown as SupabaseClient;
    fetchSpy = jest.spyOn(globalThis, 'fetch');
  });

  afterEach(() => {
    fetchSpy.mockRestore();
  });

  function client(): GoTrueAuthClient {
    return new GoTrueAuthClient(supabaseUrl, anonKey, supabaseClient);
  }

  describe.each([
    [400, { error: 'invalid_request' }],
    [401, { error: 'invalid_grant', error_description: 'Invalid login credentials' }],
    [429, { error: 'too_many_requests' }],
    [500, { error: 'internal_error' }],
  ])('HTTP %i response', (status, body) => {
    it('resolves a normalized { ok, status, body } result — never throws', async () => {
      fetchSpy.mockResolvedValue(mockResponse(status, body));

      const result = await client().passwordGrant('user@example.com', 'super-secret-pw');

      expect(result).toEqual({ ok: status < 300, status, body });
    });
  });

  it('resolves ok:true on a 200 password grant', async () => {
    const body = { access_token: 'a', refresh_token: 'b' };
    fetchSpy.mockResolvedValue(mockResponse(200, body));

    const result = await client().passwordGrant('user@example.com', 'pw');

    expect(result).toEqual({ ok: true, status: 200, body });
  });

  it('rejects when fetch itself rejects (network failure)', async () => {
    fetchSpy.mockRejectedValue(new TypeError('fetch failed'));

    await expect(client().passwordGrant('user@example.com', 'super-secret-pw')).rejects.toThrow(
      'fetch failed',
    );
  });

  it('rejects when the request times out (AbortError)', async () => {
    const abortError = new DOMException('The operation was aborted', 'AbortError');
    fetchSpy.mockRejectedValue(abortError);

    await expect(client().passwordGrant('user@example.com', 'super-secret-pw')).rejects.toBe(abortError);
  });

  it('never lets the raw password appear in a thrown message or cause chain', async () => {
    expect.assertions(3);
    const password = 'super-secret-pw-12345';
    fetchSpy.mockRejectedValue(new TypeError('network error'));

    try {
      await client().passwordGrant('user@example.com', password);
    } catch (error) {
      expect(String(error)).not.toContain(password);
      expect((error as Error).message).not.toContain(password);
      expect(JSON.stringify((error as Error).cause ?? null)).not.toContain(password);
    }
  });

  it('sends the exact password-grant request shape', async () => {
    fetchSpy.mockResolvedValue(mockResponse(200, {}));

    await client().passwordGrant('user@example.com', 'pw');

    expect(fetchSpy).toHaveBeenCalledWith(
      `${supabaseUrl}/auth/v1/token?grant_type=password`,
      expect.objectContaining({
        method: 'POST',
        headers: expect.objectContaining({ apikey: anonKey, Authorization: `Bearer ${anonKey}` }),
        body: JSON.stringify({ email: 'user@example.com', password: 'pw' }),
      }),
    );
  });

  it('sends the exact refresh-grant request shape', async () => {
    fetchSpy.mockResolvedValue(mockResponse(200, {}));

    await client().refreshGrant('rt-123');

    expect(fetchSpy).toHaveBeenCalledWith(
      `${supabaseUrl}/auth/v1/token?grant_type=refresh_token`,
      expect.objectContaining({
        method: 'POST',
        headers: expect.objectContaining({ apikey: anonKey, Authorization: `Bearer ${anonKey}` }),
        body: JSON.stringify({ refresh_token: 'rt-123' }),
      }),
    );
  });

  it('revoke delegates to the injected SupabaseClient admin API with local scope', async () => {
    await client().revoke('access-token-xyz');

    expect(signOut).toHaveBeenCalledWith('access-token-xyz', 'local');
  });
});
