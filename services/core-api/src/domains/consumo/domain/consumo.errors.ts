/**
 * Domain-invariant violations for `consumo` (core-api-consumo spec,
 * design.md's "Errores de dominio" table). Plain `Error` subclasses, zero
 * framework imports (core-api-hexagonal-layout: `domain/`/`ports-in/` MUST
 * NOT import HTTP-framework types) — a ports-in caller never throws these
 * directly as an HTTP response; `adapters/http/consumo-exception.filter.ts`
 * (Phase 2b+) maps each class to a status code. More classes are appended
 * here as later phases need them — this file is never edited destructively,
 * only appended to (mirrors `catalogo/domain/catalogo.errors.ts`'s
 * precedent).
 */

/**
 * Maps to 404 `CONSUMPTION_NOT_FOUND` in `adapters/http/` (design.md's error
 * table). Thrown by `MarcarDosisTomadaUseCase`/`CalcularDiasRestantesUseCase`
 * when `findById(consumptionId)` returns `null` OR returns an item whose
 * `userId` does not match the caller's `actor.profileId` (D7) — BOTH
 * branches throw this exact same error, constructed the exact same way
 * (design.md Diagrama 3: "Byte a byte identico a la rama 'no existe'"). A
 * 403 in the cross-tenant branch would confirm the resource exists and
 * belongs to someone else, letting an actor enumerate `consumptionId` to
 * probe another user's health data by observing 403-vs-404 — 404 in both
 * branches closes that channel (same R1-shaped risk `catalogo` closed for
 * `actualizarPrecio`).
 */
export class ConsumptionNotFoundError extends Error {
  constructor(consumptionId: string) {
    super(`Consumo ${consumptionId} no encontrado.`);
    this.name = 'ConsumptionNotFoundError';
  }
}

/**
 * Maps to 404 `PET_NOT_FOUND` in `adapters/http/` (design.md's error table).
 * Thrown by `ConfigurarConsumoUseCase` when a client-supplied `petId`
 * resolves to `null` via `PetRepository.findById` OR resolves to a pet whose
 * `userId` does not match the caller's `actor.profileId` — the same D7 rule
 * applied to the one client-supplied FK this domain has (design.md D-H.3).
 * Byte-identical to "the pet does not exist"; never a 403.
 */
export class PetNotFoundError extends Error {
  constructor(petId: string) {
    super(`Mascota ${petId} no encontrada.`);
    this.name = 'PetNotFoundError';
  }
}

/**
 * Maps to 400 `CONSUMO_INVALIDO` in `adapters/http/` (design.md's error
 * table). Thrown by `domain/user-consumption.entity.ts`'s `crear()` when any
 * of its three invariants fails: `petId` presence must match
 * `ownerType === 'pet'` exactly (never present when `'self'`, always present
 * when `'pet'`), `dosisPorToma > 0`, and `horarios` must be non-empty
 * (Phase 2a).
 */
export class ConsumoInvalidoError extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'ConsumoInvalidoError';
  }
}

/**
 * Maps to 400 `MASCOTA_INVALIDA` in `adapters/http/` (design.md's error
 * table). Thrown by `domain/pet.entity.ts`'s `crear()` when `nombre` or
 * `especie` is empty/blank (Phase 2a).
 */
export class MascotaInvalidaError extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'MascotaInvalidaError';
  }
}

/**
 * Maps to 400 `DOSIS_INVALIDA` in `adapters/http/` (design.md's error
 * table). Thrown by `MarcarDosisTomadaUseCase` when the DTO's optional
 * `tomadoAt` resolves to a timestamp in the future — a small clock-skew
 * tolerance is allowed, the exact bound is `sdd-spec`'s scenario text
 * (Phase 4). An absent `tomadoAt` never throws this: it defaults to the
 * server's `now()`.
 */
export class DosisInvalidaError extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'DosisInvalidaError';
  }
}
