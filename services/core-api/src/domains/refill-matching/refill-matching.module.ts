import { Module } from '@nestjs/common';
import { DatabaseModule } from '../../shared/database/database.module';
import { KyselyRefillRepository } from './adapters/persistence/kysely-refill.repository';
import { RefillController } from './adapters/http/refill.controller';
import { CrearSolicitudUseCase } from './ports-in/crear-solicitud.use-case';
import { REFILL_REPOSITORY } from './ports-out/refill-repository.port';

/**
 * design.md "Wiring de módulos y tokens" — first real wiring of
 * `refill-matching.module.ts`, grown incrementally per design.md's own
 * §"Secuencia de implementación" table (this is PR4b of the pre-split
 * 10-PR chain, `tasks.md` task 4b.6). `imports: [DatabaseModule]` ONLY —
 * NOT `CatalogoModule` yet: that lands in Phase 5b, when
 * `BuscarProveedoresCompatiblesUseCase` needs `CATALOG_QUERY_PORT`
 * (design.md: "`CatalogoModule` es la PRIMERA arista de dependencia entre
 * dos modulos de dominio del repo"). `DatabaseModule` is redundant (it's
 * `@Global`) but explicit — same style as Identidad/Catalogo/Consumo.
 *
 * `RefillExceptionFilter` is deliberately NOT listed as a provider — it has
 * zero DI dependencies, so `@UseFilters(RefillExceptionFilter)` on
 * `RefillController` instantiates it directly. Mirrors `consumo.module.ts`/
 * `catalogo.module.ts`: neither lists its own exception filter as a
 * provider either.
 *
 * Phase 5a/5b add `BuscarProveedoresCompatiblesUseCase` + `CatalogoModule`;
 * Phase 6a add `CrearBorradorRefillUseCase` + `RefillAutoSolicitadoListener`;
 * Phase 6b add `CompletarBorradorUseCase`; Phase 7 add
 * `MarcarComoOfertadaUseCase`/`MarcarComoConfirmadaUseCase` (providers only,
 * no route — D6). Each phase EXTENDS this same `providers` array, never
 * replaces this file.
 *
 * `exports: []`, deliberately (D7): this domain has no `contracts/` and
 * nothing else imports from it — still true after this PR.
 */
@Module({
  imports: [DatabaseModule],
  controllers: [RefillController],
  providers: [
    { provide: REFILL_REPOSITORY, useClass: KyselyRefillRepository },
    CrearSolicitudUseCase,
  ],
  exports: [],
})
export class RefillMatchingModule {}
