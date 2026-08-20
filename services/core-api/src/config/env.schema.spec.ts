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
  SUPABASE_ANON_KEY: 'anon-key',
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

  it('rejects a missing SUPABASE_ANON_KEY', () => {
    const { SUPABASE_ANON_KEY, ...rest } = validHs256Env;

    expect(() => validateEnv(rest)).toThrow(/SUPABASE_ANON_KEY/);
  });

  it('defaults TRUST_PROXY_HOPS to 0 when absent', () => {
    const result = validateEnv(validHs256Env);

    expect(result.TRUST_PROXY_HOPS).toBe(0);
  });

  it('accepts an explicit TRUST_PROXY_HOPS', () => {
    const result = validateEnv({ ...validHs256Env, TRUST_PROXY_HOPS: '2' });

    expect(result.TRUST_PROXY_HOPS).toBe(2);
  });

  it('defaults CORS_ALLOWED_ORIGINS to the two local mobile-web dev ports when absent', () => {
    const result = validateEnv(validHs256Env);

    expect(result.CORS_ALLOWED_ORIGINS).toBe('http://localhost:8091,http://localhost:8092');
  });

  it('accepts an explicit CORS_ALLOWED_ORIGINS', () => {
    const result = validateEnv({
      ...validHs256Env,
      CORS_ALLOWED_ORIGINS: 'https://usuario.repon.cl,https://proveedor.repon.cl',
    });

    expect(result.CORS_ALLOWED_ORIGINS).toBe('https://usuario.repon.cl,https://proveedor.repon.cl');
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

  // consumo design.md D-E: CONSUMO_CRON_ENABLED is a STRING enum
  // ('true'|'false'), deliberately never z.coerce.boolean() (Boolean('false')
  // === true in JS — the exact footgun D-E rejects). Any value outside the
  // two-literal union is a fail-fast boot error, same as an invalid
  // AUTH_JWT_MODE above.
  it('rejects a CONSUMO_CRON_ENABLED value outside the true|false union', () => {
    expect(() => validateEnv({ ...validHs256Env, CONSUMO_CRON_ENABLED: 'yes' })).toThrow(
      InvalidEnvError,
    );
  });

  it('defaults CONSUMO_CRON_ENABLED to "true" when absent', () => {
    const result = validateEnv(validHs256Env);

    expect(result.CONSUMO_CRON_ENABLED).toBe('true');
  });
});
