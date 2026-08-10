import { Module } from '@nestjs/common';
import { DatabaseModule } from '../../shared/database/database.module';
import { KyselyConsumptionRepository } from './adapters/persistence/kysely-consumption.repository';
import { KyselyPetRepository } from './adapters/persistence/kysely-pet.repository';
import { ConsumoController } from './adapters/http/consumo.controller';
import { CalcularDiasRestantesUseCase } from './ports-in/calcular-dias-restantes.use-case';
import { ConfigurarConsumoUseCase } from './ports-in/configurar-consumo.use-case';
import { RegistrarMascotaUseCase } from './ports-in/registrar-mascota.use-case';
import { CONSUMPTION_REPOSITORY } from './ports-out/consumption-repository.port';
import { PET_REPOSITORY } from './ports-out/pet-repository.port';

/**
 * design.md "Wiring de módulos y tokens" — `consumo.module.ts`'s wiring,
 * grown incrementally per design.md's own §"Secuencia de implementación"
 * table. PR2b bound `CONSUMPTION_REPOSITORY` (only `findById` implemented
 * then). This PR (3) adds `PET_REPOSITORY` → `KyselyPetRepository` (D-H.1,
 * first implementer) and registers the 2 write use cases —
 * `CONSUMPTION_REPOSITORY`'s `save` is now implemented too, see that file's
 * doc comment. `CONSUMPTION_LOG_REPOSITORY` remains unbound until PR4 needs
 * it — no `useValue: {}` placeholder, same rule this file's previous
 * placeholder doc comment already stated. `ConsumoExceptionFilter` is NOT
 * listed as a provider — it has zero DI dependencies, so `@UseFilters
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
    { provide: PET_REPOSITORY, useClass: KyselyPetRepository },
    CalcularDiasRestantesUseCase,
    RegistrarMascotaUseCase,
    ConfigurarConsumoUseCase,
  ],
  exports: [],
})
export class ConsumoModule {}
