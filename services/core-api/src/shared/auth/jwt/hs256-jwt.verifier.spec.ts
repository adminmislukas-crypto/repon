import { SignJWT } from 'jose';
import { Hs256JwtVerifier } from './hs256-jwt.verifier';
import { InvalidTokenError } from './jwt-verifier.port';

// core-api-auth-guard spec, "Token fails signature, issuer, audience, or
// expiry verification" — auth.guard.spec.ts mocks `JwtVerifier` entirely, so
// none of this file's real `jose` wiring (algorithm pinning, issuer/audience
// checks, sub-claim extraction) is exercised anywhere else. This is the
// security-relevant boundary: R1 (no DB-level backstop) makes token
// verification the sole gate, so its config wiring gets real crypto, not a
// mock.

const ISSUER = 'https://issuer.test';
const AUDIENCE = 'core-api';
const SECRET = 'unit-test-hs256-secret-value-not-used-anywhere-real';
const SUBJECT = '11111111-1111-1111-1111-111111111111';

function buildVerifier(
  overrides: Partial<{ secret: string; issuer: string; audience: string }> = {},
) {
  return new Hs256JwtVerifier({ secret: SECRET, issuer: ISSUER, audience: AUDIENCE, ...overrides });
}

async function sign(
  claims: Record<string, unknown>,
  options: {
    alg?: string;
    secret?: string;
    issuer?: string;
    audience?: string;
    subject?: string;
    expiresInSeconds?: number;
  } = {},
): Promise<string> {
  const key = new TextEncoder().encode(options.secret ?? SECRET);
  let jwt = new SignJWT(claims)
    .setProtectedHeader({ alg: options.alg ?? 'HS256' })
    .setIssuedAt()
    .setIssuer(options.issuer ?? ISSUER)
    .setAudience(options.audience ?? AUDIENCE)
    .setExpirationTime(Math.floor(Date.now() / 1000) + (options.expiresInSeconds ?? 3600));
  if (options.subject !== undefined) {
    jwt = jwt.setSubject(options.subject);
  }
  return jwt.sign(key);
}

describe('Hs256JwtVerifier', () => {
  it('resolves the sub claim for a validly signed token', async () => {
    const token = await sign({}, { subject: SUBJECT });

    await expect(buildVerifier().verify(token)).resolves.toEqual({ sub: SUBJECT });
  });

  it('throws InvalidTokenError for a token signed with the wrong secret', async () => {
    const token = await sign({}, { subject: SUBJECT, secret: 'a-different-secret-entirely' });

    await expect(buildVerifier().verify(token)).rejects.toBeInstanceOf(InvalidTokenError);
  });

  it('throws InvalidTokenError for the wrong issuer', async () => {
    const token = await sign({}, { subject: SUBJECT, issuer: 'https://someone-else.test' });

    await expect(buildVerifier().verify(token)).rejects.toBeInstanceOf(InvalidTokenError);
  });

  it('throws InvalidTokenError for the wrong audience', async () => {
    const token = await sign({}, { subject: SUBJECT, audience: 'some-other-api' });

    await expect(buildVerifier().verify(token)).rejects.toBeInstanceOf(InvalidTokenError);
  });

  it('throws InvalidTokenError for an expired token', async () => {
    const token = await sign({}, { subject: SUBJECT, expiresInSeconds: -60 });

    await expect(buildVerifier().verify(token)).rejects.toBeInstanceOf(InvalidTokenError);
  });

  it('throws InvalidTokenError when the algorithm is not HS256, even with the correct secret (no algorithm confusion)', async () => {
    const token = await sign({}, { subject: SUBJECT, alg: 'HS384' });

    await expect(buildVerifier().verify(token)).rejects.toBeInstanceOf(InvalidTokenError);
  });

  it('throws InvalidTokenError when the token has no sub claim', async () => {
    const token = await sign({});

    await expect(buildVerifier().verify(token)).rejects.toBeInstanceOf(InvalidTokenError);
  });
});
