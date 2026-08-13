import type { RefillItem, SolicitudElegible, Urgencia } from '@repon/types';
import type { TransactionContext } from '../../../shared/database/transaction';

/**
 * `ofertas/SPEC.md`, "Puertos de salida" (design.md D-G.1, D1/D5,
 * backend-core-api-ofertas PR 1). El puerto de la proyección de
 * descubrimiento — NUEVO, sin precedente en este dominio. Su único
 * implementador (`KyselyOfferOpportunityRepository`) llega en la Phase 3b;
 * este archivo tiene CERO implementers hasta entonces, por diseño.
 *
 * `OportunidadSnapshot`/`OportunidadElegible` declarados LOCALMENTE en este
 * archivo, nunca en `@repon/types` (design.md D-G.1's own note): ningún
 * `SPEC.md` los nombra, así que siguen el camino de `NuevaMascotaInput`/
 * `CompletarRefillItemInput` — un tipo interno del boundary ports-out, no
 * vocabulario compartido del monorepo.
 */

/** Item de la solicitud tal como llega en el `MatchEncontrado` que dispara
 *  `reemplazar()` — mismas 5 columnas que `offer_opportunity_items`. */
export interface OportunidadSnapshotItem {
  readonly refillItemId: string;
  readonly nombre: string;
  readonly categoria: string;
  readonly precioReferencia: number;
  readonly catalogProductId: string | null;
}

/** Entrada completa de `reemplazar()` — cabecera + el conjunto elegible
 *  completo de esta corrida (design.md D-A.2, los 5 pasos del writer). */
export interface OportunidadSnapshot {
  readonly refillRequestId: string;
  readonly userId: string;
  readonly comuna: string;
  readonly urgencia: Urgencia;
  readonly companyIds: readonly string[];
  readonly items: readonly OportunidadSnapshotItem[];
}

/**
 * Resultado de `findElegible()` — cabecera + items VIGENTES, ya como
 * `RefillItem[]` (design.md D-G.1: "no es casualidad" que `items` sea
 * exactamente ese tipo — es la firma congelada de
 * `CatalogQueryPort.buscarCoincidencias`, sin una línea de adaptación).
 */
export interface OportunidadElegible {
  readonly refillRequestId: string;
  readonly userId: string;
  readonly comuna: string;
  readonly urgencia: Urgencia;
  readonly cerradaAt: string | null;
  readonly items: RefillItem[];
}

export interface OfferOpportunityRepository {
  /**
   * D5 — replace por solicitud, 5 sentencias como máximo, retire-blanket-
   * then-upsert (design.md D-A.2), `cerrada_at` nunca tocado (D-A.3).
   * `companyIds: []` omite el paso de upsert de empresas — el retire en
   * bloque ya deja la solicitud sin elegibles. **`tx` REQUERIDO** (D-G.5):
   * el estado intermedio (retire hecho, upsert pendiente) no debe ser
   * observable por un lector concurrente.
   */
  reemplazar(snapshot: OportunidadSnapshot, tx: TransactionContext): Promise<void>;

  /**
   * D11/D8 — usado por `enviarOferta` ANTES de abrir cualquier transacción
   * (D13/R3). `null` si la solicitud no existe O si `companyId` no es
   * elegible — el caller no distingue los dos casos (`SolicitudNoElegibleError`
   * es byte-idéntico en ambos). No filtra por `cerrada_at`: el caller decide
   * el 409 (D-G.1 no lo dice; ver design.md Diagrama 2, paso 5).
   */
  findElegible(refillRequestId: string, companyId: string): Promise<OportunidadElegible | null>;

  /**
   * D-E — la lista del proveedor (`GET /ofertas/oportunidades`), 1 query
   * con 2 joins, filtra `vigente`/`cerrada_at is null` (design.md Diagrama
   * 3). Nunca lleva `userId` (`SolicitudElegible`'s own shape).
   */
  listarPorCompany(companyId: string): Promise<SolicitudElegible[]>;

  /**
   * D10 — "¿esta empresa fue alguna vez elegible sobre alguna solicitud de
   * este usuario?", la única relación proveedor↔usuario que el esquema
   * puede probar hoy. Usado por `enviarOfertaProactiva` antes de componer
   * la oferta.
   */
  existeRelacion(companyId: string, userId: string): Promise<boolean>;

  /**
   * D12 — cierra la oportunidad tras `aceptarOferta`. Idempotente y
   * monótono: `UPDATE ... WHERE cerrada_at IS NULL`. **`tx` REQUERIDO**
   * (D-G.5), misma clase de operación que `reemplazar`.
   */
  cerrar(refillRequestId: string, tx: TransactionContext): Promise<void>;
}

export const OFFER_OPPORTUNITY_REPOSITORY = Symbol('OFFER_OPPORTUNITY_REPOSITORY');
