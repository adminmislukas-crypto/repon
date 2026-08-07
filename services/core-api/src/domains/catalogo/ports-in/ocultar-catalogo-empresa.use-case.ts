import { Inject, Injectable } from '@nestjs/common';
import {
  CATALOG_VISIBILITY_PROJECTION,
  type CatalogVisibilityProjection,
} from '../ports-out/catalog-visibility-projection.port';

/**
 * design.md D-A: internal maintenance operation, never exposed via HTTP —
 * no route, no controller, no `@Roles`. The ONLY caller is
 * `CompanyVisibilityListener` (`adapters/events/company-visibility
 * .listener.ts`, Phase 8a), reacting to `empresa.suspendida`.
 *
 * A thin pass-through to `CatalogVisibilityProjection.ocultarEmpresa` —
 * kept as its own `ports-in/` class (rather than the listener calling the
 * port directly) for the same reason every other mutation in this domain
 * goes through one: a single seam for a future business rule (e.g. an
 * audit trail on visibility changes) without touching the listener's
 * event-wiring at all.
 */
@Injectable()
export class OcultarCatalogoEmpresaUseCase {
  constructor(
    @Inject(CATALOG_VISIBILITY_PROJECTION)
    private readonly catalogVisibilityProjection: CatalogVisibilityProjection,
  ) {}

  async execute(companyId: string, motivo: string | null): Promise<void> {
    await this.catalogVisibilityProjection.ocultarEmpresa(companyId, motivo);
  }
}
