import type { ConsumptionKind, OwnerType } from '@repon/types';

/**
 * Shared payload shape for `StockBajoDetectado`/`RefillAutoSolicitado`
 * (design.md D-D, "Los payloads" — verbatim). D-D's rule, not just its
 * fields: `consumo` publishes ONLY the facts it owns, in its own
 * vocabulary, plus a stable correlation key. It never publishes another
 * domain's enum (no `urgencia` — that is `refill-matching`'s vocabulary) or
 * another domain's interpretation. When a fact is the output of a formula
 * `consumo` owns, it publishes the OUTPUT (`consumoDiario`), never the
 * formula's own inputs (`dosisPorToma`/`frecuenciaDias`/`horarios`) — every
 * consumer would otherwise have to re-implement `domain/consumo.calculos.ts`
 * and drift from it over time.
 */
export interface StockBajoPayload {
  /** Correlation key. Stable, and the only identifier a consumer can use to
   *  deduplicate or point back at this consumption. */
  readonly consumptionId: string;
  readonly userId: string;
  readonly ownerType: OwnerType;
  /** Present iff `ownerType === 'pet'`. The pet's NAME does NOT travel: it
   *  would require a per-item lookup inside the cron's loop (N+1), and the
   *  push message is composed here, where that lookup is not needed. */
  readonly petId: string | null;
  readonly kind: ConsumptionKind;
  readonly nombre: string;
  readonly unidad: string | null;
  readonly stockActual: number;
  /** Output of the formula, not its inputs. Units per day. */
  readonly consumoDiario: number;
  readonly diasRestantes: number;
  /** Without this, `diasRestantes` is uninterpretable: the threshold will
   *  change (D-B), and a consumer that logs history needs both together. */
  readonly umbralDias: number;
}
