import { Global, Module } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { createClient, type SupabaseClient } from '@supabase/supabase-js';
import { GoTrueAuthClient } from './gotrue-auth.client';

// design.md D-A: this client is scoped to Auth Admin (`.auth.admin.*`,
// consumed by `identidad`'s `SupabaseAuthProvider`, Phase 4a onward) and
// Storage (`.storage.*`, no domain in this change uses it yet) ONLY.
// `supabase-js`'s type doesn't let us narrow `.from()`/PostgREST queries
// out at the type level, so this is an enforced-by-convention boundary
// (code review + this comment), not a compile-time one — see D-A's
// rationale for why: PostgREST has no multi-statement transactions, so
// every repository goes through Kysely/`DATABASE` instead (`shared/database/`).
export const SUPABASE_CLIENT = Symbol('SUPABASE_CLIENT');

// mobile-auth-login design.md D-1: a stateless direct-HTTP client for
// GoTrue's password/refresh grants, anon-keyed — deliberately not a second
// `supabase-js` client (see `gotrue-auth.client.ts`'s own doc comment for
// the concurrency rationale). Reuses `SUPABASE_CLIENT` only for its
// `auth.admin.signOut` revocation call.
export const GOTRUE_AUTH_CLIENT = Symbol('GOTRUE_AUTH_CLIENT');

@Global()
@Module({
  providers: [
    {
      provide: SUPABASE_CLIENT,
      inject: [ConfigService],
      useFactory: (config: ConfigService): SupabaseClient =>
        createClient(
          config.getOrThrow<string>('SUPABASE_URL'),
          config.getOrThrow<string>('SUPABASE_SERVICE_ROLE_KEY'),
          {
            auth: {
              // Server-side service-role client: no session to persist or
              // refresh on behalf of a browser.
              autoRefreshToken: false,
              persistSession: false,
            },
          },
        ),
    },
    {
      provide: GOTRUE_AUTH_CLIENT,
      inject: [ConfigService, SUPABASE_CLIENT],
      useFactory: (config: ConfigService, supabaseClient: SupabaseClient): GoTrueAuthClient =>
        new GoTrueAuthClient(
          config.getOrThrow<string>('SUPABASE_URL'),
          config.getOrThrow<string>('SUPABASE_ANON_KEY'),
          supabaseClient,
        ),
    },
  ],
  exports: [SUPABASE_CLIENT, GOTRUE_AUTH_CLIENT],
})
export class SupabaseModule {}
