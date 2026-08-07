import { Inject, Injectable } from '@nestjs/common';
import {
  CATALOG_VISIBILITY_PROJECTION,
  type CatalogVisibilityProjection,
} from '../ports-out/catalog-visibility-projection.port';

/**
 * design.md D-A: internal maintenance operation, never exposed via HTTP —
 * no route, no controller, no `@Roles`. The SHARED handler for BOTH
 * `empresa.reactivada` and `empresa.aprobada` (Diagram 2's "MISMO handler"
 * note) — `CompanyVisibilityListener` (Phase 8a) calls this same use case
 * for either event, since `AprobarEmpresaUseCase` has no state
 * precondition and can also move a company out of `'suspendido'`.
 *
 * A thin pass-through to `CatalogVisibilityProjection.mostrarEmpresa` — a
 * 0-rows-affected update (a company that was never hidden) is success, not
 * an error; that idempotency lives in the projection adapter itself, this
 * use case has nothing extra to check.
 */
@Injectable()
export class RestaurarCatalogoEmpresaUseCase {
  constructor(
    @Inject(CATALOG_VISIBILITY_PROJECTION)
    private readonly catalogVisibilityProjection: CatalogVisibilityProjection,
  ) {}

  async execute(companyId: string): Promise<void> {
    await this.catalogVisibilityProjection.mostrarEmpresa(companyId);
  }
}
