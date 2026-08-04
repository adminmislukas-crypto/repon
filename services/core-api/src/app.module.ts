import { Module } from '@nestjs/common';
import { ConfigModule } from '@nestjs/config';
import { validateEnv } from './config/env.schema';
import { HealthController } from './health/health.controller';
import { AuditModule } from './shared/audit/audit.module';
import { DatabaseModule } from './shared/database/database.module';
import { EventBusModule } from './shared/event-bus/event-bus.module';
import { SupabaseModule } from './shared/supabase/supabase.module';

// core-api-bootstrap spec, "Module composition wires the shared kernel and
// all 6 domains": this PR (tasks.md Phase 3.1-3.5) wires 4 of the shared
// kernel's modules — Database (Kysely/pg), Supabase (Auth Admin + Storage),
// EventBus, Audit. `shared/auth` (3.6-3.9: JwtVerifier/ActorPort/guards) and
// the literal `SharedKernelModule` wrapper that aggregates all of 3.1-3.9
// (task 3.10) land in PR 5, once 3.6-3.9 exist — see design.md "El registro
// APP_GUARD NO va en el slice 3": `ACTOR_PORT` has no provider until
// `IdentidadModule` (Phase 4a), so the app can't boot with a guard mounted
// yet either way. The 5 placeholder domain modules (Phase 5) aren't wired
// yet — each of these 4 modules is `@Global()` already, so no re-import is
// needed once they land.
@Module({
  imports: [
    ConfigModule.forRoot({
      isGlobal: true,
      // Throws `InvalidEnvError` on a missing/invalid var, synchronously,
      // while `NestFactory.create()` builds this module's dependency graph —
      // Nest's own default `abortOnError` behavior logs it and exits(1)
      // itself, before `app.listen()` is ever reached (see env.schema.ts).
      validate: validateEnv,
    }),
    DatabaseModule,
    SupabaseModule,
    EventBusModule,
    AuditModule,
  ],
  controllers: [HealthController],
})
export class AppModule {}
