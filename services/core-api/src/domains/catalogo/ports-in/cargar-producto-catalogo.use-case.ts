import { randomUUID } from 'node:crypto';
import { Inject, Injectable } from '@nestjs/common';
import type { CompanyStatus, NuevoProductoProveedor, ProviderCatalogItem } from '@repon/types';
import { EmpresaNoActivaError } from '../domain/catalogo.errors';
import { crear } from '../domain/provider-catalog-item.entity';
import { ProductoAgregado } from '../events/producto-agregado.event';
import { CATALOG_REPOSITORY, type CatalogRepository } from '../ports-out/catalog-repository.port';
import {
  EVENT_PUBLISHER,
  type EventPublisher,
} from '../../../shared/event-bus/event-publisher.port';

/**
 * core-api-catalogo spec, "cargarProductoCatalogo scopes the new item to
 * the actor's company" + "The 4 mutating use cases require an active
 * company". `companyId`/`companyStatus` are explicit scalar params the
 * caller (controller, Phase 4b) derives from `actor.companyId`/
 * `actor.companyStatus` — never re-derived or trusted from `producto`
 * itself (D8): `NuevoProductoProveedor` carries no `companyId` field at
 * all, so there is nothing on the body to ignore, only nothing to trust.
 */
@Injectable()
export class CargarProductoCatalogoUseCase {
  constructor(
    @Inject(CATALOG_REPOSITORY) private readonly catalogRepository: CatalogRepository,
    @Inject(EVENT_PUBLISHER) private readonly eventPublisher: EventPublisher,
  ) {}

  async execute(
    companyId: string,
    companyStatus: CompanyStatus,
    producto: NuevoProductoProveedor,
  ): Promise<ProviderCatalogItem> {
    // D-E: checked BEFORE any repository call — one rule, shared by all 4
    // mutating use cases.
    if (companyStatus !== 'activo') {
      throw new EmpresaNoActivaError(companyId);
    }

    const item = crear({ id: randomUUID(), companyId, producto });
    await this.catalogRepository.save(item);
    await this.eventPublisher.publish(new ProductoAgregado(companyId, item.id));
    return item;
  }
}
