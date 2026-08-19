/**
 * Consumo domain — pet inventory plus user/pet consumption tracking
 * (medications, food, vaccines, supplements) and dose logs. `pets` is
 * grouped with `user_consumption` at the DB layer (`supabase/SPEC.md`,
 * lote `02`) and mirrors that grouping here.
 */

export type OwnerType = 'self' | 'pet';
export type ConsumptionKind = 'medicamento' | 'alimento' | 'vacuna' | 'suplemento';

export interface Pet {
  id: string;
  userId: string;
  nombre: string;
  especie: string;
  raza?: string;
  pesoKg?: number;
}

export interface UserConsumption {
  id: string;
  /**
   * The human owner — always present, even when `ownerType === 'pet'` (a pet
   * has no account of its own). Mirrors `Pet.userId` and
   * `db-schema-consumo`'s `user_consumption.user_id NOT NULL` column
   * (shared-types-package spec, D15). Without it, `core-api-consumo`'s D7
   * ownership check (`marcarDosisTomada`/`calcularDiasRestantes`
   * cross-tenant checks) is not expressible directly on the loaded entity.
   */
  userId: string;
  ownerType: OwnerType;
  /**
   * Only present when `ownerType === 'pet'` — enforced in `core-api`, not a
   * DB `CHECK` (`supabase/SPEC.md`, `user_consumption.pet_id` column
   * comment).
   */
  petId?: string;
  kind: ConsumptionKind;
  nombre: string;
  dosisPorToma: number;
  unidad?: string;
  frecuenciaDias: number;
  /**
   * Non-empty by construction — a consumption schedule always has at least
   * one time-of-day (`shared-types-package` spec, "Reglas de validación").
   */
  horarios: [string, ...string[]]; // "HH:mm"
  stockActual: number;
  autoCrearRefill: boolean;
}

/**
 * Deliberately does not expose `createdAt` (the physical table has it) —
 * same pattern as `Company`/`Profile`, which also omit their physical
 * `created_at`/`updated_at` columns: audit metadata, not a domain field the
 * app consumes. `tomadoAt` IS exposed because it's the business fact (when
 * the dose was taken).
 */
export interface ConsumptionLog {
  id: string;
  consumptionId: string;
  tomadoAt: string; // ISO-8601
  cantidad?: number;
}

/**
 * `GET /consumo/mis-consumos` row shape (usuario-mobile-consumo design.md
 * D-5/D7) — `diasRestantes` is attached server-side from the same pure
 * `consumoDiario`/`diasRestantes` functions `calcularDiasRestantes` already
 * uses, so the client never re-derives the formula and never issues a
 * per-item follow-up request.
 */
export interface UserConsumptionListItem extends UserConsumption {
  diasRestantes: number;
}

/** usuario-mobile-consumo design.md D-2: a colour is rendering, `tomadas
 * >= esperadas` is adherence math — the enum removes that math from the
 * client entirely. */
export type AdherenciaEstado = 'cumplido' | 'parcial' | 'incumplido' | 'sin_datos';

export interface AdherenciaDia {
  fecha: string; // 'YYYY-MM-DD', in the domain's fixed adherence timezone
  /** May be fractional when `frecuenciaDias > 1` — `user_consumption` has
   * no schedule anchor, so which calendar day is an "on" day is genuinely
   * unknown; this is stated honestly rather than faked (design.md D-2). */
  esperadas: number;
  tomadas: number;
  estado: AdherenciaEstado;
}

export interface AdherenciaItem {
  consumptionId: string;
  nombre: string;
  ownerType: OwnerType;
  petId?: string;
  kind: ConsumptionKind;
  /** Over the whole 7-day window, not per-day. */
  esperadas: number;
  tomadas: number;
  /** Integer 0-100, clamped. */
  porcentaje: number;
  /** Exactly 7 entries, oldest first, ending today. */
  dias: AdherenciaDia[];
}

/** `GET /consumo/mi-adherencia` response shape — a fixed 7-day window, no
 * month view (design.md D-2, D6: adherence math never moves to the
 * client). A user with no activity still gets a well-formed skeleton
 * (`items: []`, 7 `sin_datos` days), never `null`. */
export interface AdherenciaSemanal {
  desde: string; // 'YYYY-MM-DD' = today - 6
  hasta: string; // 'YYYY-MM-DD' = today
  /** Integer 0-100, clamped, aggregated across all items. */
  porcentaje: number;
  /** Consecutive `cumplido` days counted backwards from yesterday, not
   * today — today is still in progress. */
  rachaDias: number;
  /** Exactly 7 entries, aggregate across items. */
  dias: AdherenciaDia[];
  items: AdherenciaItem[];
}
