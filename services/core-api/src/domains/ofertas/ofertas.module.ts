import { Module } from '@nestjs/common';
import { DatabaseModule } from '../../shared/database/database.module';
import { MatchEncontradoListener } from './adapters/events/match-encontrado.listener';
import { KyselyOfferOpportunityRepository } from './adapters/persistence/kysely-offer-opportunity.repository';
import { KyselyOfferRepository } from './adapters/persistence/kysely-offer.repository';
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
 * `imports: [DatabaseModule]` ONLY — `CatalogoModule` does NOT land here.
 * It arrives in PR5b (`EnviarOfertaUseCase`'s `CatalogQueryPort` need),
 * this domain's first inter-domain module edge (design.md's own PR table).
 * `DatabaseModule` is `@Global()` and already exports both `DATABASE` and
 * `TRANSACTION_MANAGER` — listed explicitly anyway, same style as every
 * other domain module in this repo (Identidad/Catalogo/Consumo/
 * RefillMatching).
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
 * `exports: []`, deliberately (D15): this domain has no `contracts/` yet and
 * nothing else imports from it. `controllers` stays absent — the first HTTP
 * surface of this domain (`OfertasController`) is PR4b's job, not this one.
 *
 * Every later PR EXTENDS this same `providers`/`imports` array, never
 * replaces this file (same discipline `refill-matching.module.ts`'s own doc
 * comment documents phase-by-phase).
 */
@Module({
  imports: [DatabaseModule],
  providers: [
    { provide: OFFER_REPOSITORY, useClass: KyselyOfferRepository },
    { provide: OFFER_OPPORTUNITY_REPOSITORY, useClass: KyselyOfferOpportunityRepository },
    RegistrarOportunidadUseCase,
    MatchEncontradoListener,
  ],
  exports: [],
})
export class OfertasModule {}
