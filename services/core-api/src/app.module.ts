import { Module } from '@nestjs/common';
import { ConfigModule } from '@nestjs/config';
import { APP_GUARD } from '@nestjs/core';
import { validateEnv } from './config/env.schema';
import { CatalogoModule } from './domains/catalogo/catalogo.module';
import { ConsumoModule } from './domains/consumo/consumo.module';
import { IdentidadModule } from './domains/identidad/identidad.module';
import { OfertasModule } from './domains/ofertas/ofertas.module';
import { PedidosPagosModule } from './domains/pedidos-pagos/pedidos-pagos.module';
import { RefillMatchingModule } from './domains/refill-matching/refill-matching.module';
import { HealthController } from './health/health.controller';
import { AuthGuard } from './shared/auth/guards/auth.guard';
import { RolesGuard } from './shared/auth/guards/roles.guard';
import { SharedKernelModule } from './shared/shared-kernel.module';

// core-api-bootstrap spec, "Module composition wires the shared kernel and
// all 6 domains": as of PR 6 (tasks.md 4a.6 / design.md §7), imports
// `IdentidadModule` and registers `AuthGuard`+`RolesGuard` as `APP_GUARD`
// here — only safe now that `IdentidadModule` gives `ACTOR_PORT` a real
// provider. Registering it inside `AuthModule` instead would make
// `AuthModule` <-> `IdentidadModule` circular. `AuthGuard` runs first,
// `RolesGuard` second (Nest applies multiple `APP_GUARD`s in order).
//
// PR 9 (tasks.md 5.1/5.2, exploration.md D2) adds the 5 remaining domains
// as thin placeholder modules — each is an empty `@Module({})` (see their
// own file doc comments), so wiring them in here adds zero new providers
// to resolve, only proves the whole 6-domain graph composes cleanly.
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
    IdentidadModule,
    CatalogoModule,
    ConsumoModule,
    RefillMatchingModule,
    OfertasModule,
    PedidosPagosModule,
  ],
  controllers: [HealthController],
  providers: [
    { provide: APP_GUARD, useClass: AuthGuard },
    { provide: APP_GUARD, useClass: RolesGuard },
  ],
})
export class AppModule {}
