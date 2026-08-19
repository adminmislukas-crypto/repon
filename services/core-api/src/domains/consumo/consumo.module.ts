import { Module } from '@nestjs/common';
import { DatabaseModule } from '../../shared/database/database.module';
import { ConsumptionCheckJob } from './adapters/scheduling/consumption-check.job';
import { KyselyConsumptionLogRepository } from './adapters/persistence/kysely-consumption-log.repository';
import { KyselyConsumptionRepository } from './adapters/persistence/kysely-consumption.repository';
import { KyselyPetRepository } from './adapters/persistence/kysely-pet.repository';
import { ConsumoController } from './adapters/http/consumo.controller';
import { CalcularAdherenciaSemanalUseCase } from './ports-in/calcular-adherencia-semanal.use-case';
import { CalcularDiasRestantesUseCase } from './ports-in/calcular-dias-restantes.use-case';
import { ConfigurarConsumoUseCase } from './ports-in/configurar-consumo.use-case';
import { ListarConsumosUseCase } from './ports-in/listar-consumos.use-case';
import { ListarMascotasUseCase } from './ports-in/listar-mascotas.use-case';
import { MarcarDosisTomadaUseCase } from './ports-in/marcar-dosis-tomada.use-case';
import { ProcesarConsumosVencidosUseCase } from './ports-in/procesar-consumos-vencidos.use-case';
import { RegistrarMascotaUseCase } from './ports-in/registrar-mascota.use-case';
import { CONSUMPTION_LOG_REPOSITORY } from './ports-out/consumption-log-repository.port';
import { CONSUMPTION_REPOSITORY } from './ports-out/consumption-repository.port';
import { PET_REPOSITORY } from './ports-out/pet-repository.port';

/**
 * design.md "Wiring de módulos y tokens" — `consumo.module.ts`'s wiring,
 * grown incrementally per design.md's own §"Secuencia de implementación"
 * table. PR2b bound `CONSUMPTION_REPOSITORY` (only `findById` implemented
 * then). PR3 added `PET_REPOSITORY` → `KyselyPetRepository` (D-H.1, first
 * implementer) and the 2 write use cases. PR4 added
 * `CONSUMPTION_LOG_REPOSITORY` → `KyselyConsumptionLogRepository` (D-H.2,
 * first implementer) and `MarcarDosisTomadaUseCase`. This PR (6c) adds
 * `ProcesarConsumosVencidosUseCase` (D2: internal, no route, no `@Roles`)
 * and `ConsumptionCheckJob` — in `providers`, NOT `controllers`: Nest's
 * `ScheduleModule` (activated in `app.module.ts`, D1) discovers `@Cron()`
 * via reflection over every provider, the same mechanism `@OnEvent` already
 * uses for `catalogo`'s `CompanyVisibilityListener`, itself also a plain
 * provider, never a controller. `EVENT_PUBLISHER`/`NOTIFICATION_PORT`/
 * `TRANSACTION_MANAGER` are all already bound by the shared kernel
 * (`shared/event-bus/`, `shared/notifications/`, `shared/database/`), so
 * this module only needs to add the 2 consumo-owned providers.
 * `ConsumoExceptionFilter` is NOT listed as a provider — it has zero DI
 * dependencies, so `@UseFilters(ConsumoExceptionFilter)` on the controller
 * instantiates it directly, mirroring `catalogo.module.ts`
 * (`CatalogoExceptionFilter` is also absent from its `providers`).
 *
 * `exports: []`, deliberately (D9/D14): `consumo` has no `contracts/` and
 * nothing else imports from it yet — still true after this PR, since
 * `ProcesarConsumosVencidosUseCase`/`ConsumptionCheckJob` are both
 * consumo-internal.
 */
@Module({
  imports: [DatabaseModule], // redundant (DatabaseModule is @Global) but explicit, same style as Identidad/Catalogo
  controllers: [ConsumoController],
  providers: [
    { provide: CONSUMPTION_REPOSITORY, useClass: KyselyConsumptionRepository },
    { provide: CONSUMPTION_LOG_REPOSITORY, useClass: KyselyConsumptionLogRepository },
    { provide: PET_REPOSITORY, useClass: KyselyPetRepository },
    CalcularDiasRestantesUseCase,
    RegistrarMascotaUseCase,
    ConfigurarConsumoUseCase,
    MarcarDosisTomadaUseCase,
    ListarMascotasUseCase,
    ListarConsumosUseCase,
    CalcularAdherenciaSemanalUseCase,
    ProcesarConsumosVencidosUseCase,
    ConsumptionCheckJob,
  ],
  exports: [],
})
export class ConsumoModule {}
