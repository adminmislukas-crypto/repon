import { createRemoteJWKSet, jwtVerify, type JWTVerifyGetKey } from 'jose';
import { InvalidTokenError, type JwtVerifier, type JwtVerifierResult } from './jwt-verifier.port';

export interface JwksJwtVerifierConfig {
  jwksUrl: string;
  issuer: string;
  audience: string;
}

/**
 * design.md D-D: `AUTH_JWT_MODE=jwks` — the expected production mode once
 * Supabase's asymmetric-key migration lands. `createRemoteJWKSet` caches and
 * rotates keys internally; constructed once here and reused for the process
 * lifetime, never per-request.
 */
export class JwksJwtVerifier implements JwtVerifier {
  private readonly jwks: JWTVerifyGetKey;

  constructor(private readonly config: JwksJwtVerifierConfig) {
    this.jwks = createRemoteJWKSet(new URL(config.jwksUrl));
  }

  async verify(token: string): Promise<JwtVerifierResult> {
    try {
      const { payload } = await jwtVerify(token, this.jwks, {
        issuer: this.config.issuer,
        audience: this.config.audience,
      });
      if (typeof payload.sub !== 'string') {
        throw new Error('token has no sub claim');
      }
      return { sub: payload.sub };
    } catch (error) {
      throw new InvalidTokenError(error);
    }
  }
}
