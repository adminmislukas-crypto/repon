import { Module } from '@nestjs/common';
import { CatalogoModule } from '../catalogo/catalogo.module';
import { DatabaseModule } from '../../shared/database/database.module';
import { MatchEncontradoListener } from './adapters/events/match-encontrado.listener';
import { OfertasController } from './adapters/http/ofertas.controller';
import { KyselyOfferOpportunityRepository } from './adapters/persistence/kysely-offer-opportunity.repository';
import { KyselyOfferRepository } from './adapters/persistence/kysely-offer.repository';
import { AceptarOfertaUseCase } from './ports-in/aceptar-oferta.use-case';
import { EnviarOfertaProactivaUseCase } from './ports-in/enviar-oferta-proactiva.use-case';
import { EnviarOfertaUseCase } from './ports-in/enviar-oferta.use-case';
import { ListarSolicitudesElegiblesUseCase } from './ports-in/listar-solicitudes-elegibles.use-case';
import { ObtenerBandejaUseCase } from './ports-in/obtener-bandeja.use-case';
import { RegistrarOportunidadUseCase } from './ports-in/registrar-oportunidad.use-case';
import { OFFER_OPPORTUNITY_REPOSITORY } from './ports-out/offer-opportunity-repository.port';
import { OFFER_REPOSITORY } from './ports-out/offer-repository.port';

/**
 * design.md "Wiring de módulos y estructura de archivos" + "Secuencia de
 * implementación" — grown incrementally, mirroring
 * `refill-matching.module.ts`'s own precedent exactly. This batch (PR4a,
 * tasks.md task 4a.7) is the FIRST one to bind real providers: before this,
 * the module was a 2-line `@Module({})` placeholder (exploration.md D2).
 *
 * `imports: [DatabaseModule, CatalogoModule]` (PR5b, this batch) — this
 * domain's FIRST inter-domain module edge (the second in the whole repo,
 * after `refill-matching`'s own `CatalogoModule` import). `CatalogoModule`
 * already `exports: [CATALOG_QUERY_PORT]` (its own doc comment) — nothing
 * else exported by that module is imported here, matching
 * `core-api-hexagonal-layout`'s "Only contracts/ is importable across a
 * domain boundary". `EnviarOfertaUseCase` (this PR) is the sole consumer of
 * `CATALOG_QUERY_PORT` in this domain today. `DatabaseModule` is
 * `@Global()` and already exports both `DATABASE` and `TRANSACTION_MANAGER`
 * — listed explicitly anyway, same style as every other domain module in
 * this repo (Identidad/Catalogo/Consumo/RefillMatching).
 *
 * `OFFER_OPPORTUNITY_REPOSITORY` -> `KyselyOfferOpportunityRepository`
 * (PR3b's writer of D5) and `OFFER_REPOSITORY` -> `KyselyOfferRepository`
 * (PR3a's 6 methods) both bind here — the first time either token resolves
 * to a real implementation in this domain.
 *
 * `RegistrarOportunidadUseCase` is internal, no HTTP route (design.md D-E:
 * "Sin ruta. Nunca"). `MatchEncontradoListener` lives in `providers`, not a
 * separate array — `DiscoveryService` finds `@OnEvent` on any provider
 * regardless of whether it also has a route, same convention
 * `RefillAutoSolicitadoListener` already established in
 * `refill-matching.module.ts`.
 *
 * **PR4b (tasks.md 4b.6) adds this domain's first `controllers` entry**:
 * `OfertasController` (`GET /ofertas/oportunidades`) +
 * `ListarSolicitudesElegiblesUseCase` in `providers`.
 * `OfertasExceptionFilter` is deliberately NOT listed in `providers` — it
 * has zero DI dependencies of its own, and `@UseFilters(OfertasExceptionFilter)`
 * on the controller instantiates it directly, the exact same convention
 * `RefillExceptionFilter`/`ConsumoExceptionFilter`/`CatalogoExceptionFilter`
 * already established for their own domains.
 *
 * PR4b's `imports` stayed `[DatabaseModule]` alone — `listarPorCompany`
 * needs no catalog access. THIS PR (5b) adds `CatalogoModule`:
 * `EnviarOfertaUseCase` + `OfertasController`'s new `POST /ofertas` route
 * are registered below.
 *
 * PR6b (tasks.md 6b.9) adds `EnviarOfertaProactivaUseCase` — needs zero new
 * `imports`: `CatalogoModule` was already added by 5b, and this use case
 * consumes the same `CATALOG_QUERY_PORT` token via its own new method
 * (`obtenerItemsDeProveedor`, PR6a), not a second module edge.
 *
 * PR7b (tasks.md 7b.4) adds `AceptarOfertaUseCase` + `ObtenerBandejaUseCase`
 * — both were already implemented and unit-tested in PR7a with zero DI
 * wiring; this batch is their first `providers` registration. Needs zero new
 * `imports` either: neither consumes `CATALOG_QUERY_PORT`, only tokens
 * `DatabaseModule` already exports (`TRANSACTION_MANAGER`) plus this
 * module's own `OFFER_REPOSITORY`/`OFFER_OPPORTUNITY_REPOSITORY` bindings.
 *
 * `exports: []`, deliberately (D15): this domain has no `contracts/` yet and
 * nothing else imports from it.
 *
 * Every later PR EXTENDS this same `providers`/`imports`/`controllers`
 * array, never replaces this file (same discipline
 * `refill-matching.module.ts`'s own doc comment documents phase-by-phase).
 */
@Module({
  imports: [DatabaseModule, CatalogoModule],
  controllers: [OfertasController],
  providers: [
    { provide: OFFER_REPOSITORY, useClass: KyselyOfferRepository },
    { provide: OFFER_OPPORTUNITY_REPOSITORY, useClass: KyselyOfferOpportunityRepository },
    RegistrarOportunidadUseCase,
    MatchEncontradoListener,
    ListarSolicitudesElegiblesUseCase,
    EnviarOfertaUseCase,
    EnviarOfertaProactivaUseCase,
    AceptarOfertaUseCase,
    ObtenerBandejaUseCase,
  ],
  exports: [],
})
export class OfertasModule {}
