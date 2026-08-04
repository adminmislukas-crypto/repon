import { validateEnv, InvalidEnvError } from './env.schema';

// core-api-bootstrap spec, scenarios "Missing service-role key halts boot"
// and "hs256 mode without its secret halts boot" (task 2.7). `validateEnv`
// is a pure function on purpose (see env.schema.ts) so these assert on a
// thrown error instead of a process exit code.

const validHs256Env = {
  NODE_ENV: 'test',
  PORT: '3000',
  SUPABASE_URL: 'http://127.0.0.1:54321',
  SUPABASE_SERVICE_ROLE_KEY: 'service-role-key',
  DATABASE_URL: 'postgres://postgres:postgres@127.0.0.1:54322/postgres',
  AUTH_JWT_MODE: 'hs256',
  SUPABASE_JWT_SECRET: 'super-secret',
  AUTH_JWT_ISSUER: 'http://127.0.0.1:54321/auth/v1',
  AUTH_JWT_AUDIENCE: 'authenticated',
};

const validJwksEnv = {
  ...validHs256Env,
  AUTH_JWT_MODE: 'jwks',
  SUPABASE_JWT_SECRET: undefined,
  SUPABASE_JWKS_URL: 'http://127.0.0.1:54321/auth/v1/.well-known/jwks.json',
};

describe('validateEnv', () => {
  it('accepts a fully valid hs256 environment', () => {
    const result = validateEnv(validHs256Env);

    expect(result.SUPABASE_URL).toBe(validHs256Env.SUPABASE_URL);
    expect(result.AUTH_JWT_MODE).toBe('hs256');
    expect(result.PORT).toBe(3000);
  });

  it('accepts a fully valid jwks environment', () => {
    const result = validateEnv(validJwksEnv);

    expect(result.AUTH_JWT_MODE).toBe('jwks');
  });

  it('defaults NODE_ENV to development and PORT to 3000 when absent', () => {
    const { NODE_ENV, PORT, ...rest } = validHs256Env;
    const result = validateEnv(rest);

    expect(result.NODE_ENV).toBe('development');
    expect(result.PORT).toBe(3000);
  });

  it('rejects a missing SUPABASE_SERVICE_ROLE_KEY', () => {
    const { SUPABASE_SERVICE_ROLE_KEY, ...rest } = validHs256Env;

    expect(() => validateEnv(rest)).toThrow(InvalidEnvError);
  });

  it('names SUPABASE_SERVICE_ROLE_KEY in the thrown error message', () => {
    const { SUPABASE_SERVICE_ROLE_KEY, ...rest } = validHs256Env;

    expect(() => validateEnv(rest)).toThrow(/SUPABASE_SERVICE_ROLE_KEY/);
  });

  it('rejects hs256 mode without SUPABASE_JWT_SECRET', () => {
    const { SUPABASE_JWT_SECRET, ...rest } = validHs256Env;

    expect(() => validateEnv(rest)).toThrow(InvalidEnvError);
  });

  it('rejects jwks mode without SUPABASE_JWKS_URL', () => {
    const { SUPABASE_JWKS_URL, ...rest } = validJwksEnv;

    expect(() => validateEnv(rest)).toThrow(InvalidEnvError);
  });

  it('rejects a missing AUTH_JWT_MODE entirely', () => {
    const { AUTH_JWT_MODE, ...rest } = validHs256Env;

    expect(() => validateEnv(rest)).toThrow(InvalidEnvError);
  });

  it('rejects an AUTH_JWT_MODE outside the hs256|jwks union', () => {
    expect(() => validateEnv({ ...validHs256Env, AUTH_JWT_MODE: 'none' })).toThrow(InvalidEnvError);
  });
});
