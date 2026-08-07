import { Inject, Injectable } from '@nestjs/common';
import type { CompanyStatus } from '@repon/types';
import { TRANSACTION_MANAGER, type TransactionManager } from '../../../shared/database/transaction';
import {
  EVENT_PUBLISHER,
  type EventPublisher,
} from '../../../shared/event-bus/event-publisher.port';
import { EmpresaNoActivaError, PorcentajeInvalidoError } from '../domain/catalogo.errors';
import { aplicarPorcentaje } from '../domain/provider-catalog-item.entity';
import { PreciosCategoriaAjustados } from '../events/precios-categoria-ajustados.event';
import { CATALOG_REPOSITORY, type CatalogRepository } from '../ports-out/catalog-repository.port';

/**
 * core-api-catalogo spec, "ajustarPreciosPorCategoria scales both price
 * bounds and preserves the price invariant" + "emits exactly one summary
 * event" (D5/D6). `companyId`/`companyStatus` are explicit actor-derived
 * scalars (D8/D-E), never re-derived here.
 *
 * design.md "Mapa de transacciones": this is the FIRST mutating use case in
 * this domain that DOES wrap `runInTransaction` — a deliberate CONTRAST
 * with `cargarCatalogoMasivo` (D2, which must never even inject
 * `TRANSACTION_MANAGER`). The reason is the return type: `Promise<void>`
 * has no channel to report a partial application, so a half-adjusted
 * category is a silent, undetectable, uncorrectable price disaster — the
 * transaction is what makes "all items scale, or none do" true.
 *
 * `porcentaje <= -100` is rejected by THIS use case's own gate, BEFORE
 * `runInTransaction` is even entered — see `PorcentajeInvalidoError`'s own
 * doc comment (`domain/catalogo.errors.ts`) for the full reasoning on why
 * `provider-catalog-item.entity.ts`'s `aplicarPorcentaje()` guard (which
 * already exists, PR 3a) is not sufficient on its own: it only runs
 * per-item, AFTER `findByCompanyAndCategoria` (a repository READ) has
 * already executed, and would never run at all for zero matching items.
 * core-api-catalogo spec requires rejection "before touching the
 * database" — before the read, not just before the write.
 */
@Injectable()
export class AjustarPreciosPorCategoriaUseCase {
  constructor(
    @Inject(CATALOG_REPOSITORY) private readonly catalogRepository: CatalogRepository,
    @Inject(EVENT_PUBLISHER) private readonly eventPublisher: EventPublisher,
    @Inject(TRANSACTION_MANAGER) private readonly transactionManager: TransactionManager,
  ) {}

  async execute(
    companyId: string,
    companyStatus: CompanyStatus,
    categoria: string,
    porcentaje: number,
  ): Promise<void> {
    // D-E: checked BEFORE any repository call — same rule/shape as the
    // other 3 mutating use cases.
    if (companyStatus !== 'activo') {
      throw new EmpresaNoActivaError(companyId);
    }

    // Checked BEFORE `runInTransaction` — i.e. before `findByCompanyAndCategoria`
    // (a repository READ) or `saveMany` (the write) ever run. See
    // `PorcentajeInvalidoError`'s own doc comment for why this can't be
    // deferred to `aplicarPorcentaje()`'s per-item guard alone.
    if (porcentaje <= -100) {
      throw new PorcentajeInvalidoError(
        `porcentaje (${porcentaje}) no puede ser menor o igual a -100.`,
      );
    }

    const totalActualizados = await this.transactionManager.runInTransaction(async (tx) => {
      const items = await this.catalogRepository.findByCompanyAndCategoria(
        companyId,
        categoria,
        tx,
      );
      // D5: scales both precioBase/precioMaximo by the same factor,
      // preserving precioMaximo >= precioBase by construction — never
      // re-implemented here, delegated to the entity (PR 3a).
      const ajustados = items.map((item) => aplicarPorcentaje(item, porcentaje));
      await this.catalogRepository.saveMany(ajustados, tx);
      return ajustados.length;
    });

    // Exactly one event, always — even with 0 matches (D6, mirrors D3's
    // "one summary event, always" shape for cargarCatalogoMasivo) —
    // published only AFTER the transaction commits.
    await this.eventPublisher.publish(
      new PreciosCategoriaAjustados(companyId, categoria, porcentaje, totalActualizados),
    );
  }
}
