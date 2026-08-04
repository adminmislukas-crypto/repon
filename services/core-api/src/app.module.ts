import { Module } from '@nestjs/common';
import { ConfigModule } from '@nestjs/config';
import { validateEnv } from './config/env.schema';
import { HealthController } from './health/health.controller';

// Minimal on purpose (core-api-bootstrap spec, "Module composition wires the
// shared kernel and all 6 domains"): the shared kernel (`SharedKernelModule`,
// `@Global()`) and the 7 domain modules (identidad + 5 placeholders) don't
// exist until PR 4 onward. Today `AppModule` only wires env validation +
// `/health`, which is exactly what this PR's scope is (Phase 2 in tasks.md).
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
  ],
  controllers: [HealthController],
})
export class AppModule {}
