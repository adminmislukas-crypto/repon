import { Inject, Injectable } from '@nestjs/common';
import type { CompanyStatus, ProviderCatalogItem } from '@repon/types';
import { CatalogItemNotFoundError, EmpresaNoActivaError } from '../domain/catalogo.errors';
import { actualizarPrecio as actualizarPrecioEnLaEntidad } from '../domain/provider-catalog-item.entity';
import { CATALOG_REPOSITORY, type CatalogRepository } from '../ports-out/catalog-repository.port';

/**
 * core-api-catalogo spec, "actualizarPrecio is scoped to the caller's own
 * company; cross-tenant access is a 404" — the R1 mitigation (design.md
 * Diagram 3). `companyId`/`companyStatus` are explicit actor-derived
 * scalars (D8/D-E), never re-derived here.
 *
 * `findById(itemId)` returning `null` and `findById(itemId)` returning an
 * item whose `companyId` does not match the caller's throw the EXACT SAME
 * `CatalogItemNotFoundError`, constructed the exact same way (no
 * branch-specific message, no branch-specific shape) — a 403 in the
 * cross-tenant branch would confirm the item exists and belongs to someone
 * else, letting an actor enumerate `itemId` to map another company's
 * catalog by observing a 403-vs-404 split. 404 in both branches closes that
 * channel. The internal log (out of scope for this use case's return
 * value) MAY distinguish the two for observability; the thrown error and
 * the HTTP response it maps to (Phase 4b) never do.
 */
@Injectable()
export class ActualizarPrecioUseCase {
  constructor(@Inject(CATALOG_REPOSITORY) private readonly catalogRepository: CatalogRepository) {}

  async execute(
    companyId: string,
    companyStatus: CompanyStatus,
    itemId: string,
    precioBase: number,
    precioMaximo: number,
  ): Promise<ProviderCatalogItem> {
    // D-E: checked BEFORE any repository call — same rule/shape as
    // CargarProductoCatalogoUseCase.
    if (companyStatus !== 'activo') {
      throw new EmpresaNoActivaError(companyId);
    }

    const item = await this.catalogRepository.findById(itemId);
    if (!item || item.companyId !== companyId) {
      throw new CatalogItemNotFoundError(itemId);
    }

    // D-C/D5: rounding + invariant validation happen in the entity, never
    // here and never trusting the DB CHECK.
    const actualizado = actualizarPrecioEnLaEntidad(item, precioBase, precioMaximo);
    await this.catalogRepository.save(actualizado);
    return actualizado;
  }
}
