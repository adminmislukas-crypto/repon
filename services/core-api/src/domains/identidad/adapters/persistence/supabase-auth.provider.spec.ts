import type { AuthError, SupabaseClient } from '@supabase/supabase-js';
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

describe('SupabaseAuthProvider', () => {
  describe('createAccount', () => {
    it('returns the created user id on success', async () => {
      const { supabase, createUser } = buildSupabase();
      createUser.mockResolvedValue({ data: { user: { id: 'uid-1' } }, error: null });
      const provider = new SupabaseAuthProvider(supabase);

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
      const provider = new SupabaseAuthProvider(supabase);

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
      const provider = new SupabaseAuthProvider(supabase);

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
      const provider = new SupabaseAuthProvider(supabase);

      await expect(provider.createAccount('a@example.com', 'secret')).rejects.toMatchObject({
        reason: 'other',
      });
    });

    it('classifies a 5xx error as ambiguous', async () => {
      const { supabase, createUser } = buildSupabase();
      createUser.mockResolvedValue({ data: { user: null }, error: authError({ status: 503 }) });
      const provider = new SupabaseAuthProvider(supabase);

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
      const provider = new SupabaseAuthProvider(supabase);

      await expect(provider.createAccount('a@example.com', 'secret')).rejects.toBeInstanceOf(
        AuthProviderAmbiguousError,
      );
    });
  });

  describe('deleteAccount', () => {
    it('resolves on success', async () => {
      const { supabase, deleteUser } = buildSupabase();
      deleteUser.mockResolvedValue({ data: { user: {} }, error: null });
      const provider = new SupabaseAuthProvider(supabase);

      await expect(provider.deleteAccount('uid-1')).resolves.toBeUndefined();
      expect(deleteUser).toHaveBeenCalledWith('uid-1');
    });

    it('throws the raw error on failure — classification is only for createAccount', async () => {
      const { supabase, deleteUser } = buildSupabase();
      deleteUser.mockResolvedValue({ data: { user: null }, error: authError({ status: 500 }) });
      const provider = new SupabaseAuthProvider(supabase);

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
      const provider = new SupabaseAuthProvider(supabase);

      await expect(provider.findAccountByEmail('match@example.com')).resolves.toEqual({
        id: 'uid-2',
      });
    });

    it('returns null when no user matches', async () => {
      const { supabase, listUsers } = buildSupabase();
      listUsers.mockResolvedValue({ data: { users: [] }, error: null });
      const provider = new SupabaseAuthProvider(supabase);

      await expect(provider.findAccountByEmail('nobody@example.com')).resolves.toBeNull();
    });
  });
});
