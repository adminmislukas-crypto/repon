import { Hs256JwtVerifier } from './hs256-jwt.verifier';
import { JwksJwtVerifier } from './jwks-jwt.verifier';
import { selectJwtVerifier } from './jwt-verifier.factory';

// core-api-auth-guard spec, "Mode is fixed for the process lifetime" —
// `selectJwtVerifier` is the pure function `AuthModule`'s factory calls
// exactly once at boot; this asserts the mode → implementation mapping
// without bootstrapping Nest's DI container.

function params(mode: string) {
  return {
    mode,
    issuer: 'https://issuer.test',
    audience: 'core-api',
    hs256Secret: 'unit-test-secret',
    jwksUrl: 'https://issuer.test/.well-known/jwks.json',
  };
}

describe('selectJwtVerifier', () => {
  it('returns a JwksJwtVerifier when mode is "jwks"', () => {
    expect(selectJwtVerifier(params('jwks'))).toBeInstanceOf(JwksJwtVerifier);
  });

  it('returns an Hs256JwtVerifier when mode is "hs256"', () => {
    expect(selectJwtVerifier(params('hs256'))).toBeInstanceOf(Hs256JwtVerifier);
  });

  it('defaults to Hs256JwtVerifier for any other mode value (fail-safe default)', () => {
    expect(selectJwtVerifier(params('unexpected'))).toBeInstanceOf(Hs256JwtVerifier);
  });
});
