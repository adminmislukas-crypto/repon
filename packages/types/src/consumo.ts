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
