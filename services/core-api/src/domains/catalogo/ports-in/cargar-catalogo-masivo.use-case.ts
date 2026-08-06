import { randomUUID } from 'node:crypto';
import { Inject, Injectable } from '@nestjs/common';
import type {
  ArchivoCarga,
  CompanyStatus,
  NuevoProductoProveedor,
  ResultadoCargaMasiva,
} from '@repon/types';
import { EmpresaNoActivaError } from '../domain/catalogo.errors';
import { crear } from '../domain/provider-catalog-item.entity';
import { CatalogoCargaMasivaCompletada } from '../events/catalogo-carga-masiva-completada.event';
import { CATALOG_REPOSITORY, type CatalogRepository } from '../ports-out/catalog-repository.port';
import {
  EVENT_PUBLISHER,
  type EventPublisher,
} from '../../../shared/event-bus/event-publisher.port';

/**
 * design.md Diagram 1 ("`cargarCatalogoMasivo` de punta a punta", D2 + D3 +
 * D11 + D-C). `archivo` arrives already parsed and framework-free
 * (`ArchivoCarga`, from `adapters/http/carga-masiva.parser.ts`'s
 * `parseArchivoCarga()` — D11: this layer never sees a framework buffer
 * type). `companyId`/`companyStatus` are explicit actor-derived scalars
 * (D8/D-E), applied identically to every row — never re-derived from
 * anything inside the file.
 *
 * D2's central guarantee, structural, not just behavioral: this class's
 * constructor injects ONLY `CatalogRepository`/`EventPublisher` — it never
 * injects `TRANSACTION_MANAGER` at all (proven by a dedicated test reading
 * this class's own `@Inject()` metadata, not just "runInTransaction is
 * never called at runtime"). Each row is processed and persisted
 * independently, one at a time — a row-level failure (validation or
 * persistence) is caught, reported in `fallos`, and the loop CONTINUES; it
 * never aborts the remaining rows and never rolls back rows already saved.
 */
@Injectable()
export class CargarCatalogoMasivoUseCase {
  constructor(
    @Inject(CATALOG_REPOSITORY) private readonly catalogRepository: CatalogRepository,
    @Inject(EVENT_PUBLISHER) private readonly eventPublisher: EventPublisher,
  ) {}

  async execute(
    companyId: string,
    companyStatus: CompanyStatus,
    archivo: ArchivoCarga,
  ): Promise<ResultadoCargaMasiva> {
    // D-E: checked BEFORE any row is touched — same rule/shape as the
    // other 3 mutating use cases.
    if (companyStatus !== 'activo') {
      throw new EmpresaNoActivaError(companyId);
    }

    const fallos: Array<{ numero: number; motivo: string }> = [];
    const identidadesVistas = new Set<string>();
    let totalCargados = 0;

    for (const fila of archivo.filas) {
      // core-api-catalogo spec, "Two rows identifying the same product
      // within one file are rejected as a duplicate, not silently merged":
      // identity is resolved purely from the FILE's own rows — by
      // `catalogProductId` when present, else by `nombre`+`categoria`
      // (normalized the same way PR 1's expression index normalizes them:
      // `lower(btrim(...))`), independent of whether the first occurrence
      // itself succeeded or failed. A 2nd occurrence is never allowed to
      // attempt a `save()` that would silently upsert over — or race
      // with — the first occurrence's own outcome.
      const identidad = identidadDeFila(fila.producto);
      if (identidadesVistas.has(identidad)) {
        fallos.push({
          numero: fila.numero,
          motivo: `Producto duplicado dentro del archivo (misma identidad que otra fila anterior).`,
        });
        continue;
      }
      identidadesVistas.add(identidad);

      try {
        const item = crear({ id: randomUUID(), companyId, producto: fila.producto });
        await this.catalogRepository.save(item);
        totalCargados++;
      } catch (error) {
        fallos.push({ numero: fila.numero, motivo: toMotivo(error) });
      }
    }

    const totalFallidos = fallos.length;
    // (3) EXACTLY ONE summary event, always — even with 0 successes. Never
    // one `ProductoAgregado` per row (D3, "Per-item events never fire
    // during batch operations").
    await this.eventPublisher.publish(
      new CatalogoCargaMasivaCompletada(companyId, totalCargados, totalFallidos),
    );

    return {
      totalFilas: archivo.filas.length,
      totalCargados,
      totalFallidos,
      fallos,
    };
  }
}

function identidadDeFila(producto: NuevoProductoProveedor): string {
  if (producto.catalogProductId) {
    return `id:${producto.catalogProductId.trim().toLowerCase()}`;
  }
  return `nc:${producto.nombre.trim().toLowerCase()}::${producto.categoria.trim().toLowerCase()}`;
}

function toMotivo(error: unknown): string {
  return error instanceof Error ? error.message : String(error);
}
