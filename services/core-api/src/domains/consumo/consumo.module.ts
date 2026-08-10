import { Module } from '@nestjs/common';
import { DatabaseModule } from '../../shared/database/database.module';
import { KyselyConsumptionLogRepository } from './adapters/persistence/kysely-consumption-log.repository';
import { KyselyConsumptionRepository } from './adapters/persistence/kysely-consumption.repository';
import { KyselyPetRepository } from './adapters/persistence/kysely-pet.repository';
import { ConsumoController } from './adapters/http/consumo.controller';
import { CalcularDiasRestantesUseCase } from './ports-in/calcular-dias-restantes.use-case';
import { ConfigurarConsumoUseCase } from './ports-in/configurar-consumo.use-case';
import { MarcarDosisTomadaUseCase } from './ports-in/marcar-dosis-tomada.use-case';
import { RegistrarMascotaUseCase } from './ports-in/registrar-mascota.use-case';
import { CONSUMPTION_LOG_REPOSITORY } from './ports-out/consumption-log-repository.port';
import { CONSUMPTION_REPOSITORY } from './ports-out/consumption-repository.port';
import { PET_REPOSITORY } from './ports-out/pet-repository.port';

/**
 * design.md "Wiring de módulos y tokens" — `consumo.module.ts`'s wiring,
 * grown incrementally per design.md's own §"Secuencia de implementación"
 * table. PR2b bound `CONSUMPTION_REPOSITORY` (only `findById` implemented
 * then). PR3 added `PET_REPOSITORY` → `KyselyPetRepository` (D-H.1, first
 * implementer) and the 2 write use cases. This PR (4) adds
 * `CONSUMPTION_LOG_REPOSITORY` → `KyselyConsumptionLogRepository` (D-H.2,
 * first implementer) and `MarcarDosisTomadaUseCase` — `EVENT_PUBLISHER`/
 * `TRANSACTION_MANAGER` are both already bound by the shared kernel
 * (`shared/event-bus/`, `shared/database/`), so this module only needs to
 * add the 2 consumo-owned providers. `ConsumoExceptionFilter` is NOT listed
 * as a provider — it has zero DI dependencies, so `@UseFilters
 * (ConsumoExceptionFilter)` on the controller instantiates it directly,
 * mirroring `catalogo.module.ts` (`CatalogoExceptionFilter` is also absent
 * from its `providers`).
 *
 * `exports: []`, deliberately (D9/D14): `consumo` has no `contracts/` and
 * nothing else imports from it yet.
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
  ],
  exports: [],
})
export class ConsumoModule {}
