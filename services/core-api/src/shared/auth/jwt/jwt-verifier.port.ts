/**
 * Thrown by any `JwtVerifier` on a bad signature, issuer, audience, or
 * expired token — `AuthGuard` maps this to 401 `INVALID_TOKEN`, never a raw
 * `jose` error (`core-api-auth-guard` spec, "Token fails signature, issuer,
 * audience, or expiry verification").
 */
export class InvalidTokenError extends Error {
  constructor(cause?: unknown) {
    super('JWT verification failed');
    this.name = 'InvalidTokenError';
    this.cause = cause;
  }
}

export interface JwtVerifierResult {
  sub: string;
}

/**
 * The verification mode (`hs256`/`jwks`) is chosen once at boot by
 * `AUTH_JWT_MODE` (design.md D-D) — never re-selected per request.
 */
export interface JwtVerifier {
  verify(token: string): Promise<JwtVerifierResult>;
}

export const JWT_VERIFIER = Symbol('JWT_VERIFIER');
