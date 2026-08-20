import { z } from 'zod';

// core-api-bootstrap spec, "Env validation fails fast at boot":
//   - SUPABASE_URL / SUPABASE_SERVICE_ROLE_KEY / DATABASE_URL are required
//     unconditionally.
//   - AUTH_JWT_MODE is a discriminated union: SUPABASE_JWT_SECRET is required
//     iff mode is `hs256`; SUPABASE_JWKS_URL is required iff mode is `jwks`
//     (design.md D-D). Nothing in this PR *consumes* these two yet (that's
//     `shared/auth`, PR 5) — only their presence is validated now, so the
//     process never boots into a state where PR 5's guard would silently
//     have no secret/JWKS URL to read.
//   - AUTH_JWT_ISSUER / AUTH_JWT_AUDIENCE are always required regardless of
//     mode.
//
// `AUTH_JWT_MODE` itself has no schema-level default: `.env.example` documents
// `hs256` as the *recommended local value* to copy into `.env`, but the
// schema stays fail-fast — a missing mode is a config error, not a silent
// default, same class of failure as a missing SUPABASE_SERVICE_ROLE_KEY.

const baseEnvSchema = z.object({
  NODE_ENV: z.enum(['development', 'test', 'production']).default('development'),
  PORT: z.coerce.number().int().positive().default(3000),
  SUPABASE_URL: z.string().min(1, 'SUPABASE_URL is required'),
  SUPABASE_SERVICE_ROLE_KEY: z.string().min(1, 'SUPABASE_SERVICE_ROLE_KEY is required'),
  // mobile-auth-login design.md D-1: the anon-scoped key `GoTrueAuthClient`
  // sends as `apikey`/`Authorization` on the password/refresh grants — never
  // the service-role key above. Required unconditionally, same fail-fast
  // class as `SUPABASE_SERVICE_ROLE_KEY`.
  SUPABASE_ANON_KEY: z.string().min(1, 'SUPABASE_ANON_KEY is required'),
  DATABASE_URL: z.string().min(1, 'DATABASE_URL is required'),
  AUTH_JWT_ISSUER: z.string().min(1, 'AUTH_JWT_ISSUER is required'),
  AUTH_JWT_AUDIENCE: z.string().min(1, 'AUTH_JWT_AUDIENCE is required'),
  // consumo design.md D-E: the cron kill-switch. A STRING enum on purpose,
  // never `z.coerce.boolean()` — `Boolean('false') === true` in JS, which
  // would make `CONSUMO_CRON_ENABLED=false` silently fail to disable the
  // job. Consuming code (adapters/scheduling/consumption-check.job.ts)
  // compares the raw string against `'false'`/`'true'`, never treats this
  // as a real boolean. Validated here so an out-of-union value is a
  // fail-fast boot error, not a silent default (D-E).
  CONSUMO_CRON_ENABLED: z.enum(['true', 'false']).default('true'),
  // mobile-auth-login design.md D-3: how many hops of `X-Forwarded-For` to
  // trust for `req.ip` (Express `trust proxy`). `0` (default) is correct for
  // local dev with no reverse proxy in front; behind a load balancer this
  // MUST be set to the real hop count, or the per-IP rate-limit key
  // degrades into one shared bucket for every request. Has a safe default,
  // so — unlike the vars above — it is not fail-fast, same class as
  // NODE_ENV/PORT below.
  TRUST_PROXY_HOPS: z.coerce.number().int().min(0).default(0),
  // mobile-auth-login: comma-separated allowlist for `app.enableCors()`
  // (main.ts). Both mobile apps run as a browser web target in local dev
  // (Expo `web.output: "static"`), on a different port than core-api — every
  // `fetch()` from either app's origin to core-api is genuinely cross-origin,
  // and the browser blocks it silently without a matching
  // `Access-Control-Allow-Origin` response header (confirmed: the OPTIONS
  // preflight 404s with none set, which `curl` never surfaces since CORS is
  // a browser-only enforcement — this went undetected until a real browser
  // login was tried). Defaults to both local Expo web ports so `/repon up`
  // works out of the box; override in staging/prod to the real app origins.
  CORS_ALLOWED_ORIGINS: z.string().min(1).default('http://localhost:8091,http://localhost:8092'),
});

const hs256EnvSchema = baseEnvSchema.extend({
  AUTH_JWT_MODE: z.literal('hs256'),
  SUPABASE_JWT_SECRET: z
    .string()
    .min(1, 'SUPABASE_JWT_SECRET is required when AUTH_JWT_MODE=hs256'),
});

const jwksEnvSchema = baseEnvSchema.extend({
  AUTH_JWT_MODE: z.literal('jwks'),
  SUPABASE_JWKS_URL: z.string().min(1, 'SUPABASE_JWKS_URL is required when AUTH_JWT_MODE=jwks'),
});

export const envSchema = z.discriminatedUnion('AUTH_JWT_MODE', [hs256EnvSchema, jwksEnvSchema]);

export type EnvConfig = z.infer<typeof envSchema>;

export class InvalidEnvError extends Error {
  constructor(issues: string[]) {
    super(
      `Invalid environment configuration:\n${issues.map((issue) => `  - ${issue}`).join('\n')}`,
    );
    this.name = 'InvalidEnvError';
  }
}

/**
 * Validates `process.env` (or an injected record, for tests) against the
 * fail-fast schema above.
 *
 * Throws — never calls `process.exit` itself, so this stays a plain,
 * unit-testable pure function (task 2.7) instead of killing the Jest worker
 * process. Nest's own `NestFactory.create` default `abortOnError` behavior
 * is what turns this throw into the actual non-zero exit at boot (verified:
 * it happens synchronously during `ConfigModule.forRoot`'s dependency-graph
 * construction, inside `NestFactory.create`, logged via Nest's own Logger —
 * `main.ts`'s `bootstrap().catch()` is a secondary net for errors after a
 * *successful* `create()`, not the path this particular throw takes).
 */
export function validateEnv(config: Record<string, unknown>): EnvConfig {
  const result = envSchema.safeParse(config);
  if (!result.success) {
    const issues = result.error.issues.map(
      (issue) => `${issue.path.join('.') || '(root)'}: ${issue.message}`,
    );
    throw new InvalidEnvError(issues);
  }
  return result.data;
}
