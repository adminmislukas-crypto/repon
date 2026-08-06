import { Module } from '@nestjs/common';
import { DatabaseModule } from '../../shared/database/database.module';
import { KyselyCatalogProductRepository } from './adapters/persistence/kysely-catalog-product.repository';
import { KyselyCatalogQueryAdapter } from './adapters/persistence/kysely-catalog-query.adapter';
import { KyselyCatalogRepository } from './adapters/persistence/kysely-catalog.repository';
import { CatalogoController } from './adapters/http/catalogo.controller';
import { CATALOG_QUERY_PORT } from './contracts/catalog-query.port';
import { ActualizarPrecioUseCase } from './ports-in/actualizar-precio.use-case';
import { BuscarProductosUseCase } from './ports-in/buscar-productos.use-case';
import { CargarCatalogoMasivoUseCase } from './ports-in/cargar-catalogo-masivo.use-case';
import { CargarProductoCatalogoUseCase } from './ports-in/cargar-producto-catalogo.use-case';
import { CATALOG_PRODUCT_REPOSITORY } from './ports-out/catalog-product-repository.port';
import { CATALOG_REPOSITORY } from './ports-out/catalog-repository.port';

/**
 * design.md "Wiring de módulos y tokens". Phase 4b added the 2 unit-write
 * use cases — `KyselyCatalogRepository.save()` was implemented and tested
 * in Phase 4a. Phase 5b (this slice) adds `CargarCatalogoMasivoUseCase`,
 * reusing the same `CATALOG_REPOSITORY`/`EVENT_PUBLISHER` providers,
 * calling `save()` once per row (never `saveMany()`) — `saveMany()` still
 * throws ("not yet available") until PR 6 — correct today because nothing
 * in this module's provider graph calls it yet.
 * `exports: [CATALOG_QUERY_PORT]` — the ONLY artifact this domain exposes
 * across its boundary (core-api-hexagonal-layout: "Only contracts/ is
 * importable across a domain boundary").
 */
@Module({
  imports: [DatabaseModule],
  controllers: [CatalogoController],
  providers: [
    { provide: CATALOG_REPOSITORY, useClass: KyselyCatalogRepository },
    { provide: CATALOG_QUERY_PORT, useClass: KyselyCatalogQueryAdapter },
    { provide: CATALOG_PRODUCT_REPOSITORY, useClass: KyselyCatalogProductRepository },
    BuscarProductosUseCase,
    CargarProductoCatalogoUseCase,
    ActualizarPrecioUseCase,
    CargarCatalogoMasivoUseCase,
  ],
  exports: [CATALOG_QUERY_PORT],
})
export class CatalogoModule {}
