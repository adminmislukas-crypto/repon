import { Hs256JwtVerifier } from './hs256-jwt.verifier';
import { JwksJwtVerifier } from './jwks-jwt.verifier';
import type { JwtVerifier } from './jwt-verifier.port';

export interface JwtVerifierFactoryParams {
  mode: string;
  issuer: string;
  audience: string;
  hs256Secret: string;
  jwksUrl: string;
}

/**
 * design.md D-D: the mode is chosen once here, at boot — `AuthModule`'s
 * `JWT_VERIFIER` factory calls this exactly once per process lifetime,
 * never per request (`core-api-auth-guard` spec, "Mode is fixed for the
 * process lifetime"). A pure function so the selection is unit-testable
 * without bootstrapping Nest's DI container. `env.schema.ts` already
 * guarantees the field the chosen mode needs is non-empty by the time this
 * runs (fail-fast at `ConfigModule.forRoot`); this trusts that.
 */
export function selectJwtVerifier(params: JwtVerifierFactoryParams): JwtVerifier {
  return params.mode === 'jwks'
    ? new JwksJwtVerifier({ jwksUrl: params.jwksUrl, issuer: params.issuer, audience: params.audience })
    : new Hs256JwtVerifier({ secret: params.hs256Secret, issuer: params.issuer, audience: params.audience });
}
