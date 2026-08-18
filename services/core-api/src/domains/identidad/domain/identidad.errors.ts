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

/**
 * Maps to 401 `CREDENCIALES_INVALIDAS` in `adapters/http/` (mobile-auth-login
 * design.md D-4, Phase 9). Thrown by `IniciarSesionUseCase` for both an
 * unknown email and a wrong password — deliberately the same class/message
 * either way, so the two are indistinguishable to the caller (spec:
 * "Wrong password and unknown email are indistinguishable").
 */
export class CredencialesInvalidasError extends Error {
  constructor(message = 'Credenciales inválidas.', options?: ErrorOptions) {
    super(message, options);
    this.name = 'CredencialesInvalidasError';
  }
}

/**
 * Maps to 401 `SESION_EXPIRADA` in `adapters/http/` (mobile-auth-login
 * design.md D-4, Phase 9). Thrown by `RefrescarSesionUseCase` when
 * `AuthProvider.refreshSession` classifies the refresh token as
 * expired/reused/rotated-away — the refresh-time counterpart to
 * `CredencialesInvalidasError`, distinct so the client knows to sign out
 * rather than retry.
 */
export class SesionExpiradaError extends Error {
  constructor(message = 'La sesión ha expirado.', options?: ErrorOptions) {
    super(message, options);
    this.name = 'SesionExpiradaError';
  }
}

/**
 * Maps to 503 `AUTH_PROVIDER_NO_DISPONIBLE` in `adapters/http/`
 * (mobile-auth-login design.md D-4, Phase 9). Thrown by `IniciarSesionUseCase`/
 * `RefrescarSesionUseCase` when `AuthProvider.signIn`/`refreshSession`
 * rejects with `AuthProviderAmbiguousError` (429/5xx/network failure/timeout)
 * — never collapsed into `CredencialesInvalidasError`, per the explicit
 * success criterion that a backend outage is never phrased as "invalid
 * credentials".
 */
export class AuthProviderNoDisponibleError extends Error {
  constructor(message = 'El proveedor de autenticación no está disponible.', options?: ErrorOptions) {
    super(message, options);
    this.name = 'AuthProviderNoDisponibleError';
  }
}

/**
 * Maps to 403 `PROFILE_SUSPENDED` in `adapters/http/` (mobile-auth-login
 * design.md D-4a, Phase 9). Thrown by `assertSesionPermitida` when a
 * profile's `status` is `'suspendido'` at login or refresh time — refused
 * before any session material is returned, and the just-minted GoTrue
 * grant is revoked (D-4a's exit). Reuses the wire `code` `AuthGuard` already
 * emits for the same condition on a later authenticated request, but is a
 * distinct class — `AuthError`/`AuthErrorCode` (`shared/auth/`) stay
 * untouched; only the `code` string is shared, not the class.
 */
export class PerfilSuspendidoError extends Error {
  constructor(message = 'El perfil está suspendido.', options?: ErrorOptions) {
    super(message, options);
    this.name = 'PerfilSuspendidoError';
  }
}

/**
 * Maps to 403 `COMPANY_SUSPENDED` in `adapters/http/` (mobile-auth-login
 * design.md D-4a, Phase 9). Thrown by `assertSesionPermitida` for a
 * `role === 'provider'` whose `companyStatus` is `'suspendido'`. This is a
 * business rule the login/refresh use cases own, not `AuthGuard` —
 * `companyStatus` is loaded but deliberately never enforced by the guard
 * on later authenticated requests (`shared/auth/ports/actor.port.ts`).
 */
export class EmpresaSuspendidaError extends Error {
  constructor(message = 'La empresa está suspendida.', options?: ErrorOptions) {
    super(message, options);
    this.name = 'EmpresaSuspendidaError';
  }
}

/**
 * Maps to 403 `ROL_NO_PERMITIDO` in `adapters/http/` (mobile-auth-login
 * design.md D-5, Phase 9). Thrown by `assertSesionPermitida` when the
 * client-supplied `expectedRole` doesn't match the resolved profile's
 * role. UX only, never the security boundary — `AuthGuard`/`RolesGuard`
 * remain the sole authorization boundary on subsequent requests, unaffected
 * by this check.
 */
export class RolNoPermitidoError extends Error {
  constructor(message = 'La cuenta no tiene el rol esperado para esta aplicación.', options?: ErrorOptions) {
    super(message, options);
    this.name = 'RolNoPermitidoError';
  }
}
