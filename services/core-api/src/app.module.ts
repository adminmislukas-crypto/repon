import { Module } from '@nestjs/common';
import { ConfigModule } from '@nestjs/config';
import { validateEnv } from './config/env.schema';
import { HealthController } from './health/health.controller';
import { SharedKernelModule } from './shared/shared-kernel.module';

// core-api-bootstrap spec, "Module composition wires the shared kernel and
// all 6 domains": this PR (tasks.md task 3.10) collapses the 4 direct
// module imports PR 4 left here into the single `SharedKernelModule`
// wrapper, now that `shared/auth` (3.6-3.9) exists for it to aggregate too.
// `AuthGuard`/`RolesGuard` are exported by `SharedKernelModule` but NOT yet
// registered as `APP_GUARD` here — `ACTOR_PORT` has no provider until
// `IdentidadModule` (Phase 4a / PR 6), so the app can't boot with a global
// guard mounted yet (design.md, "El registro APP_GUARD NO va en el slice
// 3"). The 5 placeholder domain modules (Phase 5) aren't wired yet.
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
    SharedKernelModule,
  ],
  controllers: [HealthController],
})
export class AppModule {}
