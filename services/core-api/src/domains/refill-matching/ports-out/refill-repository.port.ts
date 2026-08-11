import type { RefillEstadoActivo, RefillRequest, RefillRequestBorrador } from '@repon/types';
import type { TransactionContext } from '../../../shared/database/transaction';

/**
 * `refill-matching/SPEC.md`, "Puertos de salida" — final shape (design.md
 * D-G.2, backend-core-api-refill-matching PR 1). Interface + DI token only:
 * every method below lands incrementally, in the PR that first needs it
 * (`save`/`findById` in Phase 3, `findBorradorByConsumption` in Phase 6a,
 * `actualizarEstado` in Phase 7) — this PR has zero implementers, by design
 * (mirrors `catalogo` PR 1's `CatalogRepository` and `consumo` PR 1's
 * `ConsumptionRepository`).
 */
export interface RefillRepository {
  /**
   * Upsert de la solicitud + TODOS sus ítems, keyeado por id. Sirve al
   * insert de `crearSolicitud` (Phase 4a) y al update in-place de
   * `completarBorrador` (Phase 6b) — nunca borra ítems (criterio de éxito
   * de la proposal: "ningún DELETE físico introducido"). Bajo D14 el caller
   * SIEMPRE pasa `tx`: dos escrituras acopladas (la request + sus N ítems)
   * y una firma sin canal para reportar éxito parcial exigen atomicidad.
   */
  save(request: RefillRequest, tx?: TransactionContext): Promise<void>;

  /** Trae la solicitud con sus ítems (1 select con join). Poder de dueño lo
   *  verifica el caller comparando `entity.userId` contra `actor.profileId`
   *  (D13) — este método no filtra por dueño, solo trae la fila. */
  findById(id: string, tx?: TransactionContext): Promise<RefillRequest | null>;

  /**
   * D-D.3 — dedup del listener de `RefillAutoSolicitado` (Phase 6a). NUEVO.
   * Devuelve el borrador abierto de ese `(userId, consumptionId)` si existe,
   * o `null` si no hay ninguno o si el único que hubo ya transicionó fuera
   * de `'borrador'` — el índice parcial único de la migración `15` (design.md
   * D-A) es la red real contra el TOCTOU; este método es el read-and-skip
   * que hace que el camino normal sea un no-op limpio, no una excepción del
   * driver.
   */
  findBorradorByConsumption(
    userId: string,
    consumptionId: string,
    tx?: TransactionContext,
  ): Promise<RefillRequestBorrador | null>;

  /**
   * D6/D-G.2 — transición pura de estado (`marcarComoOfertada`/
   * `marcarComoConfirmada`, Phase 7), sin reescribir ítems. NUEVO. `save()`
   * reescribiría la fila entera desde un snapshot en memoria — mismo motivo
   * exacto por el que el cron de `consumo` tiene prohibido usar `save()`
   * para sus transiciones de estado (`intentarMarcarStockBajo`/
   * `limpiarMarcaStockBajo`, `consumo` PR 1 D-A): una sentencia angosta que
   * NUNCA toca `refill_items` es la única forma de que un
   * `actualizarEstado` concurrente no pise una escritura de ítems en curso.
   */
  actualizarEstado(id: string, estado: RefillEstadoActivo, tx?: TransactionContext): Promise<void>;
}

export const REFILL_REPOSITORY = Symbol('REFILL_REPOSITORY');
