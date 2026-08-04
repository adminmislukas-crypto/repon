// `@nestjs/config`'s `ConfigModule.forRoot({ validate })` runs `validateEnv`
// (env.schema.ts) eagerly, synchronously, at `forRoot()` call time — which
// happens the moment `app.module.ts` is imported/required (decorator
// arguments are evaluated at class-definition time), i.e. before any
// `beforeAll` in a spec file that merely imports `AppModule` gets to run.
//
// A Jest `setupFiles` entry runs before the test framework is installed and
// before the test file's own `require`/`import` chain executes — the only
// hook early enough to set `process.env` ahead of that eager validation.
process.env.NODE_ENV ??= 'test';
process.env.SUPABASE_URL ??= 'http://127.0.0.1:54321';
process.env.SUPABASE_SERVICE_ROLE_KEY ??= 'test-service-role-key';
process.env.DATABASE_URL ??= 'postgres://postgres:postgres@127.0.0.1:54322/postgres';
process.env.AUTH_JWT_MODE ??= 'hs256';
process.env.SUPABASE_JWT_SECRET ??= 'test-secret';
process.env.AUTH_JWT_ISSUER ??= 'http://127.0.0.1:54321/auth/v1';
process.env.AUTH_JWT_AUDIENCE ??= 'authenticated';
