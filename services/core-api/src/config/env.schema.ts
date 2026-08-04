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
  DATABASE_URL: z.string().min(1, 'DATABASE_URL is required'),
  AUTH_JWT_ISSUER: z.string().min(1, 'AUTH_JWT_ISSUER is required'),
  AUTH_JWT_AUDIENCE: z.string().min(1, 'AUTH_JWT_AUDIENCE is required'),
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
