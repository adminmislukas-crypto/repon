/**
 * Pure calculation functions for `consumo` (design.md Diagram 1, step 2a).
 * These are the SOLE authority for the formula: `ConsumptionRepository
 * .findDueForCheck`'s SQL predicate (D-C) is a strict SUPERSET of the
 * decision made here, never the decision itself. Zero I/O, zero repository
 * lookups — testable in complete isolation (Phase 2a).
 */

export interface ConsumoDiarioInput {
  dosisPorToma: number;
  horarios: readonly string[];
  frecuenciaDias: number;
}

/**
 * `dosisPorToma * horarios.length / frecuenciaDias` (design.md Diagram 1,
 * step 2a, verbatim). Units of the item consumed per day.
 */
export function consumoDiario(input: ConsumoDiarioInput): number {
  return (input.dosisPorToma * input.horarios.length) / input.frecuenciaDias;
}

/**
 * `Math.floor(stockActual / consumoDiario)` (design.md Diagram 1, step 2a,
 * verbatim). `Math.floor`, never `Math.round`/`Math.ceil`: a partial day of
 * stock does not count as a full day remaining. This is exactly why D-C's
 * SQL predicate carries a `+1` margin instead of relying on `< umbralDias`
 * alone — Postgres `numeric` division and JS `float64` division are not
 * guaranteed to agree bit-for-bit at the boundary, and this function itself
 * makes no attempt to compensate for that: it is the single source of
 * truth for the JS side, the predicate is the superset guard.
 */
export function diasRestantes(stockActual: number, consumoDiarioValor: number): number {
  return Math.floor(stockActual / consumoDiarioValor);
}

export interface MensajeStockBajoInput {
  nombre: string;
  diasRestantes: number;
  unidad: string | null;
}

/**
 * Composes the push message body (design.md D-G, Diagram 1 step 2g:
 * `sendPush(userId, mensajeStockBajo(...))`). Pure — takes only the fields
 * `consumo` already owns on the entity/event payload (D-D). Deliberately
 * does NOT accept a pet lookup: resolving the pet's name would require a
 * per-item lookup inside the cron's loop (N+1), which D-D explicitly
 * rejects. `nombre` here is the CONSUMPTION's own `nombre` field, never the
 * pet's.
 */
export function mensajeStockBajo(input: MensajeStockBajoInput): string {
  const dias = input.diasRestantes === 1 ? '1 día' : `${input.diasRestantes} días`;
  const conUnidad = input.unidad ? ` de ${input.unidad}` : '';
  return `Stock bajo: a ${input.nombre} le quedan ${dias}${conUnidad}.`;
}
