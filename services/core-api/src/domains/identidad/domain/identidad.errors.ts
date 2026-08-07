/**
 * Domain-invariant violations and use-case-level failures for `identidad`
 * (core-api-identidad spec, tasks.md 4b.6 "shared domain error types ...
 * used across the 6 use cases"). Plain `Error` subclasses, zero framework
 * imports (core-api-hexagonal-layout: `domain/`/`ports-in/` MUST NOT import
 * HTTP-framework types) — a ports-in caller never throws these directly as
 * an HTTP response; `adapters/http/` (Phase 4c) maps each class to a status
 * code (see the class-level comments below for the intended mapping).
 */
export class InvalidProfileError extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'InvalidProfileError';
  }
}

/** Maps to 409 in `adapters/http/` (Phase 4c) — `auth-provisioning` RAMA C, `reason: 'email_taken'`. */
export class EmailYaRegistradoError extends Error {
  constructor(email: string) {
    super(`El correo ${email} ya está registrado.`);
    this.name = 'EmailYaRegistradoError';
  }
}

/** Maps to 502 in `adapters/http/` — `AuthProviderDeterministicError` with any reason other than `email_taken`. */
export class AuthProviderError extends Error {
  constructor(
    message = 'El proveedor de autenticación rechazó la operación.',
    options?: ErrorOptions,
  ) {
    super(message, options);
    this.name = 'AuthProviderError';
  }
}

/**
 * Maps to 503 in `adapters/http/` — `auth-provisioning` RAMA A (deterministic
 * `profiles`-insert failure, compensated) or RAMA B with no forward-recovery
 * match (clean, retryable, `deleteAccount` never called).
 */
export class RegistroFallidoError extends Error {
  constructor(message = 'No fue posible completar el registro.', options?: ErrorOptions) {
    super(message, options);
    this.name = 'RegistroFallidoError';
  }
}

/**
 * Maps to 404 in `adapters/http/`. Required before any status-mutating
 * `save`/`update` call: `CompanyRepository.save`/`ProfileRepository.update`
 * are unconditional upsert/update (no "does this row exist" signal on their
 * own — an upsert on a missing id would silently create a bogus row instead
 * of updating), and the audit `cambios.antes` value needs the current row
 * regardless.
 */
export class CompanyNotFoundError extends Error {
  constructor(companyId: string) {
    super(`Empresa ${companyId} no encontrada.`);
    this.name = 'CompanyNotFoundError';
  }
}

/** Maps to 404 in `adapters/http/`. Same rationale as `CompanyNotFoundError`. */
export class ProfileNotFoundError extends Error {
  constructor(profileId: string) {
    super(`Perfil ${profileId} no encontrado.`);
    this.name = 'ProfileNotFoundError';
  }
}

/**
 * Maps to 409 in `adapters/http/` (D-D, `backend-core-api-catalogo`).
 * `reactivarEmpresa`'s one deliberate asymmetry against `suspenderEmpresa`:
 * the destination state (`activo`) is permissive, so unlike suspension it
 * requires a precondition — the target company must currently be
 * `'suspendido'`. Thrown before any write, so no `audit_log` row is ever
 * created for a rejected reactivation attempt.
 */
export class CompanyNotSuspendedError extends Error {
  constructor(companyId: string) {
    super(`Empresa ${companyId} no está suspendida.`);
    this.name = 'CompanyNotSuspendedError';
  }
}
