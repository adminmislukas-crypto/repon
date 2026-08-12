import { Module } from '@nestjs/common';
import { DatabaseModule } from '../../shared/database/database.module';
import { CatalogoModule } from '../catalogo/catalogo.module';
import { KyselyRefillRepository } from './adapters/persistence/kysely-refill.repository';
import { RefillController } from './adapters/http/refill.controller';
import { BuscarProveedoresCompatiblesUseCase } from './ports-in/buscar-proveedores-compatibles.use-case';
import { CrearSolicitudUseCase } from './ports-in/crear-solicitud.use-case';
import { REFILL_REPOSITORY } from './ports-out/refill-repository.port';

/**
 * design.md "Wiring de módulos y tokens" — grown incrementally per
 * design.md's own §"Secuencia de implementación" table. PR4b wired
 * `imports: [DatabaseModule]` only. PR5b (this batch, `tasks.md` task 5b.5)
 * adds `CatalogoModule` to `imports` — the **first inter-domain module
 * edge in the whole repo**: `BuscarProveedoresCompatiblesUseCase` (PR5a)
 * needs `CATALOG_QUERY_PORT`, and `CatalogoModule` already exports exactly
 * that token (`exports: [CATALOG_QUERY_PORT]`). Purely additive — zero
 * edits to any file under `domains/catalogo/` (verified via `git status
 * --porcelain services/core-api/src/domains/catalogo/` showing nothing for
 * this PR). `DatabaseModule` is redundant (it's `@Global`) but explicit —
 * same style as Identidad/Catalogo/Consumo.
 *
 * `RefillExceptionFilter` is deliberately NOT listed as a provider — it has
 * zero DI dependencies, so `@UseFilters(RefillExceptionFilter)` on
 * `RefillController` instantiates it directly. Mirrors `consumo.module.ts`/
 * `catalogo.module.ts`: neither lists its own exception filter as a
 * provider either.
 *
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
  imports: [DatabaseModule, CatalogoModule],
  controllers: [RefillController],
  providers: [
    { provide: REFILL_REPOSITORY, useClass: KyselyRefillRepository },
    CrearSolicitudUseCase,
    BuscarProveedoresCompatiblesUseCase,
  ],
  exports: [],
})
export class RefillMatchingModule {}
