import { Module } from '@nestjs/common';
import { DatabaseModule } from '../../shared/database/database.module';
import { KyselyConsumptionRepository } from './adapters/persistence/kysely-consumption.repository';
import { ConsumoController } from './adapters/http/consumo.controller';
import { CalcularDiasRestantesUseCase } from './ports-in/calcular-dias-restantes.use-case';
import { CONSUMPTION_REPOSITORY } from './ports-out/consumption-repository.port';

/**
 * design.md "Wiring de módulos y tokens" — `consumo.module.ts`'s first real
 * wiring (PR2b). `CONSUMPTION_REPOSITORY` binds to `KyselyConsumptionRepository`
 * (only `findById` implemented so far, see that file's doc comment).
 * `PET_REPOSITORY`/`CONSUMPTION_LOG_REPOSITORY` remain unbound until PR3/PR4
 * need them — no `useValue: {}` placeholder, same rule this file's previous
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
    CalcularDiasRestantesUseCase,
  ],
  exports: [],
})
export class ConsumoModule {}
