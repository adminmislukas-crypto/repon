import { jwtVerify } from 'jose';
import { InvalidTokenError, type JwtVerifier, type JwtVerifierResult } from './jwt-verifier.port';

export interface Hs256JwtVerifierConfig {
  secret: string;
  issuer: string;
  audience: string;
}

/**
 * design.md D-D: `AUTH_JWT_MODE=hs256` — the local/dev default, matching
 * `supabase start`'s static HS256 secret.
 */
export class Hs256JwtVerifier implements JwtVerifier {
  private readonly key: Uint8Array;

  constructor(private readonly config: Hs256JwtVerifierConfig) {
    this.key = new TextEncoder().encode(config.secret);
  }

  async verify(token: string): Promise<JwtVerifierResult> {
    try {
      const { payload } = await jwtVerify(token, this.key, {
        issuer: this.config.issuer,
        audience: this.config.audience,
        algorithms: ['HS256'],
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
