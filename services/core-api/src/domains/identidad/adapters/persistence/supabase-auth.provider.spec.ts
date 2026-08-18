import type { AuthError, SupabaseClient } from '@supabase/supabase-js';
import type { GoTrueAuthClient, GoTrueResult } from '../../../../shared/supabase/gotrue-auth.client';
import {
  AuthProviderAmbiguousError,
  AuthProviderDeterministicError,
} from '../../ports-out/auth-provider.port';
import { SupabaseAuthProvider } from './supabase-auth.provider';

function authError(overrides: Partial<AuthError>): AuthError {
  return {
    name: 'AuthApiError',
    message: 'boom',
    status: undefined,
    code: undefined,
    ...overrides,
  } as AuthError;
}

function buildSupabase() {
  const createUser = jest.fn();
  const deleteUser = jest.fn();
  const listUsers = jest.fn();
  const supabase = {
    auth: { admin: { createUser, deleteUser, listUsers } },
  } as unknown as SupabaseClient;
  return { supabase, createUser, deleteUser, listUsers };
}

function buildGoTrueClient() {
  const passwordGrant = jest.fn();
  const refreshGrant = jest.fn();
  const revoke = jest.fn();
  const gotrueAuthClient = { passwordGrant, refreshGrant, revoke } as unknown as GoTrueAuthClient;
  return { gotrueAuthClient, passwordGrant, refreshGrant, revoke };
}

/** Only `createAccount`/`deleteAccount`/`findAccountByEmail` tests below need this — a fresh, unasserted stand-in. */
function stubGoTrueAuthClient(): GoTrueAuthClient {
  return buildGoTrueClient().gotrueAuthClient;
}

function grantOk(body: unknown): GoTrueResult {
  return { ok: true, status: 200, body };
}

function grantError(status: number, body: unknown): GoTrueResult {
  return { ok: false, status, body };
}

describe('SupabaseAuthProvider', () => {
  describe('createAccount', () => {
    it('returns the created user id on success', async () => {
      const { supabase, createUser } = buildSupabase();
      createUser.mockResolvedValue({ data: { user: { id: 'uid-1' } }, error: null });
      const provider = new SupabaseAuthProvider(supabase, stubGoTrueAuthClient());

      const id = await provider.createAccount('a@example.com', 'secret');

      expect(id).toBe('uid-1');
      expect(createUser).toHaveBeenCalledWith({
        email: 'a@example.com',
        password: 'secret',
        email_confirm: true,
      });
    });

    it('classifies a 4xx email_exists error as deterministic email_taken', async () => {
      const { supabase, createUser } = buildSupabase();
      createUser.mockResolvedValue({
        data: { user: null },
        error: authError({ status: 422, code: 'email_exists' }),
      });
      const provider = new SupabaseAuthProvider(supabase, stubGoTrueAuthClient());

      const rejection = provider.createAccount('a@example.com', 'secret');
      await expect(rejection).rejects.toBeInstanceOf(AuthProviderDeterministicError);
      await expect(rejection).rejects.toMatchObject({ reason: 'email_taken' });
    });

    it('classifies a 4xx invalid_credentials error as deterministic invalid_credentials', async () => {
      const { supabase, createUser } = buildSupabase();
      createUser.mockResolvedValue({
        data: { user: null },
        error: authError({ status: 400, code: 'invalid_credentials' }),
      });
      const provider = new SupabaseAuthProvider(supabase, stubGoTrueAuthClient());

      await expect(provider.createAccount('a@example.com', 'secret')).rejects.toMatchObject({
        reason: 'invalid_credentials',
      });
    });

    it('classifies any other 4xx error as deterministic "other"', async () => {
      const { supabase, createUser } = buildSupabase();
      createUser.mockResolvedValue({
        data: { user: null },
        error: authError({ status: 422, code: 'weak_password' }),
      });
      const provider = new SupabaseAuthProvider(supabase, stubGoTrueAuthClient());

      await expect(provider.createAccount('a@example.com', 'secret')).rejects.toMatchObject({
        reason: 'other',
      });
    });

    it('classifies a 5xx error as ambiguous', async () => {
      const { supabase, createUser } = buildSupabase();
      createUser.mockResolvedValue({ data: { user: null }, error: authError({ status: 503 }) });
      const provider = new SupabaseAuthProvider(supabase, stubGoTrueAuthClient());

      await expect(provider.createAccount('a@example.com', 'secret')).rejects.toBeInstanceOf(
        AuthProviderAmbiguousError,
      );
    });

    it('classifies a network failure (no status) as ambiguous', async () => {
      const { supabase, createUser } = buildSupabase();
      createUser.mockResolvedValue({
        data: { user: null },
        error: authError({ status: undefined }),
      });
      const provider = new SupabaseAuthProvider(supabase, stubGoTrueAuthClient());

      await expect(provider.createAccount('a@example.com', 'secret')).rejects.toBeInstanceOf(
        AuthProviderAmbiguousError,
      );
    });
  });

  describe('deleteAccount', () => {
    it('resolves on success', async () => {
      const { supabase, deleteUser } = buildSupabase();
      deleteUser.mockResolvedValue({ data: { user: {} }, error: null });
      const provider = new SupabaseAuthProvider(supabase, stubGoTrueAuthClient());

      await expect(provider.deleteAccount('uid-1')).resolves.toBeUndefined();
      expect(deleteUser).toHaveBeenCalledWith('uid-1');
    });

    it('throws the raw error on failure — classification is only for createAccount', async () => {
      const { supabase, deleteUser } = buildSupabase();
      deleteUser.mockResolvedValue({ data: { user: null }, error: authError({ status: 500 }) });
      const provider = new SupabaseAuthProvider(supabase, stubGoTrueAuthClient());

      await expect(provider.deleteAccount('uid-1')).rejects.toBeTruthy();
    });
  });

  describe('findAccountByEmail', () => {
    it('returns the matching account id when found', async () => {
      const { supabase, listUsers } = buildSupabase();
      listUsers.mockResolvedValue({
        data: { users: [{ id: 'uid-2', email: 'match@example.com' }] },
        error: null,
      });
      const provider = new SupabaseAuthProvider(supabase, stubGoTrueAuthClient());

      await expect(provider.findAccountByEmail('match@example.com')).resolves.toEqual({
        id: 'uid-2',
      });
    });

    it('returns null when no user matches', async () => {
      const { supabase, listUsers } = buildSupabase();
      listUsers.mockResolvedValue({ data: { users: [] }, error: null });
      const provider = new SupabaseAuthProvider(supabase, stubGoTrueAuthClient());

      await expect(provider.findAccountByEmail('nobody@example.com')).resolves.toBeNull();
    });
  });

  describe('signIn', () => {
    const successBody = {
      access_token: 'access-1',
      refresh_token: 'refresh-1',
      expires_at: 1_700_000_000,
      user: { id: 'uid-3' },
    };

    it('returns an AuthSession on a 200 grant', async () => {
      const { supabase } = buildSupabase();
      const { gotrueAuthClient, passwordGrant } = buildGoTrueClient();
      passwordGrant.mockResolvedValue(grantOk(successBody));
      const provider = new SupabaseAuthProvider(supabase, gotrueAuthClient);

      const session = await provider.signIn('a@example.com', 'secret');

      expect(session).toEqual({
        accessToken: 'access-1',
        refreshToken: 'refresh-1',
        expiresAt: 1_700_000_000,
        userId: 'uid-3',
      });
      expect(passwordGrant).toHaveBeenCalledWith('a@example.com', 'secret');
    });

    it('classifies a 400 error="invalid_grant" as deterministic invalid_credentials', async () => {
      const { supabase } = buildSupabase();
      const { gotrueAuthClient, passwordGrant } = buildGoTrueClient();
      passwordGrant.mockResolvedValue(
        grantError(400, { error: 'invalid_grant', error_description: 'Invalid login credentials' }),
      );
      const provider = new SupabaseAuthProvider(supabase, gotrueAuthClient);

      await expect(provider.signIn('a@example.com', 'wrong')).rejects.toMatchObject({
        reason: 'invalid_credentials',
      });
    });

    it('classifies a 401 error_code="invalid_credentials" as deterministic invalid_credentials', async () => {
      const { supabase } = buildSupabase();
      const { gotrueAuthClient, passwordGrant } = buildGoTrueClient();
      passwordGrant.mockResolvedValue(grantError(401, { error_code: 'invalid_credentials' }));
      const provider = new SupabaseAuthProvider(supabase, gotrueAuthClient);

      await expect(provider.signIn('a@example.com', 'wrong')).rejects.toBeInstanceOf(
        AuthProviderDeterministicError,
      );
      await expect(provider.signIn('a@example.com', 'wrong')).rejects.toMatchObject({
        reason: 'invalid_credentials',
      });
    });

    it('classifies any other 4xx as deterministic "other"', async () => {
      const { supabase } = buildSupabase();
      const { gotrueAuthClient, passwordGrant } = buildGoTrueClient();
      passwordGrant.mockResolvedValue(grantError(400, { error: 'email_not_confirmed' }));
      const provider = new SupabaseAuthProvider(supabase, gotrueAuthClient);

      await expect(provider.signIn('a@example.com', 'secret')).rejects.toMatchObject({
        reason: 'other',
      });
    });

    it('classifies a 429 from GoTrue as ambiguous, not deterministic', async () => {
      const { supabase } = buildSupabase();
      const { gotrueAuthClient, passwordGrant } = buildGoTrueClient();
      passwordGrant.mockResolvedValue(grantError(429, { error: 'too_many_requests' }));
      const provider = new SupabaseAuthProvider(supabase, gotrueAuthClient);

      await expect(provider.signIn('a@example.com', 'secret')).rejects.toBeInstanceOf(
        AuthProviderAmbiguousError,
      );
    });

    it('classifies a 5xx as ambiguous', async () => {
      const { supabase } = buildSupabase();
      const { gotrueAuthClient, passwordGrant } = buildGoTrueClient();
      passwordGrant.mockResolvedValue(grantError(500, { error: 'internal_error' }));
      const provider = new SupabaseAuthProvider(supabase, gotrueAuthClient);

      await expect(provider.signIn('a@example.com', 'secret')).rejects.toBeInstanceOf(
        AuthProviderAmbiguousError,
      );
    });

    it('classifies a rejected passwordGrant (network failure/timeout) as ambiguous', async () => {
      const { supabase } = buildSupabase();
      const { gotrueAuthClient, passwordGrant } = buildGoTrueClient();
      passwordGrant.mockRejectedValue(new TypeError('fetch failed'));
      const provider = new SupabaseAuthProvider(supabase, gotrueAuthClient);

      await expect(provider.signIn('a@example.com', 'secret')).rejects.toBeInstanceOf(
        AuthProviderAmbiguousError,
      );
    });

    it('classifies a malformed 200 body (missing fields) as ambiguous, never throwing a 500-shaped error', async () => {
      const { supabase } = buildSupabase();
      const { gotrueAuthClient, passwordGrant } = buildGoTrueClient();
      passwordGrant.mockResolvedValue(grantOk({ access_token: 'a' }));
      const provider = new SupabaseAuthProvider(supabase, gotrueAuthClient);

      await expect(provider.signIn('a@example.com', 'secret')).rejects.toBeInstanceOf(
        AuthProviderAmbiguousError,
      );
    });

    it('never lets the raw password appear in a thrown error message or cause chain', async () => {
      const { supabase } = buildSupabase();
      const { gotrueAuthClient, passwordGrant } = buildGoTrueClient();
      const password = 'super-secret-pw-99';
      passwordGrant.mockRejectedValue(new TypeError('network error'));
      const provider = new SupabaseAuthProvider(supabase, gotrueAuthClient);

      try {
        await provider.signIn('a@example.com', password);
        throw new Error('expected signIn to reject');
      } catch (error) {
        expect((error as Error).message).not.toContain(password);
        expect(JSON.stringify((error as Error).cause ?? null)).not.toContain(password);
      }
    });
  });

  describe('refreshSession', () => {
    it('returns an AuthSession on a 200 grant', async () => {
      const { supabase } = buildSupabase();
      const { gotrueAuthClient, refreshGrant } = buildGoTrueClient();
      refreshGrant.mockResolvedValue(
        grantOk({
          access_token: 'access-2',
          refresh_token: 'refresh-2',
          expires_at: 1_700_000_100,
          user: { id: 'uid-4' },
        }),
      );
      const provider = new SupabaseAuthProvider(supabase, gotrueAuthClient);

      const session = await provider.refreshSession('old-refresh-token');

      expect(session).toEqual({
        accessToken: 'access-2',
        refreshToken: 'refresh-2',
        expiresAt: 1_700_000_100,
        userId: 'uid-4',
      });
      expect(refreshGrant).toHaveBeenCalledWith('old-refresh-token');
    });

    it('classifies a 400/401 (expired/reused/rotated-away token) as deterministic invalid_credentials', async () => {
      const { supabase } = buildSupabase();
      const { gotrueAuthClient, refreshGrant } = buildGoTrueClient();
      refreshGrant.mockResolvedValue(grantError(401, { error: 'invalid_grant' }));
      const provider = new SupabaseAuthProvider(supabase, gotrueAuthClient);

      await expect(provider.refreshSession('stale-token')).rejects.toMatchObject({
        reason: 'invalid_credentials',
      });
    });

    it('classifies a 5xx as ambiguous', async () => {
      const { supabase } = buildSupabase();
      const { gotrueAuthClient, refreshGrant } = buildGoTrueClient();
      refreshGrant.mockResolvedValue(grantError(503, { error: 'internal_error' }));
      const provider = new SupabaseAuthProvider(supabase, gotrueAuthClient);

      await expect(provider.refreshSession('some-token')).rejects.toBeInstanceOf(
        AuthProviderAmbiguousError,
      );
    });
  });

  describe('revokeSession', () => {
    it('delegates to the injected GoTrueAuthClient with the given access token', async () => {
      const { supabase } = buildSupabase();
      const { gotrueAuthClient, revoke } = buildGoTrueClient();
      revoke.mockResolvedValue(undefined);
      const provider = new SupabaseAuthProvider(supabase, gotrueAuthClient);

      await provider.revokeSession('access-token-xyz');

      expect(revoke).toHaveBeenCalledWith('access-token-xyz');
    });

    it('propagates a revoke failure — swallowing best-effort is the caller use case\'s job, not this adapter\'s', async () => {
      const { supabase } = buildSupabase();
      const { gotrueAuthClient, revoke } = buildGoTrueClient();
      revoke.mockRejectedValue(new Error('gotrue down'));
      const provider = new SupabaseAuthProvider(supabase, gotrueAuthClient);

      await expect(provider.revokeSession('access-token-xyz')).rejects.toThrow('gotrue down');
    });
  });
});
