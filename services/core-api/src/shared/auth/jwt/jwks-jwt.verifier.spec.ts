import { SignJWT, createLocalJWKSet, createRemoteJWKSet, exportJWK, generateKeyPair } from 'jose';
import type { KeyLike } from 'jose';
import { JwksJwtVerifier } from './jwks-jwt.verifier';
import { InvalidTokenError } from './jwt-verifier.port';

// core-api-auth-guard spec, "Token fails signature, issuer, audience, or
// expiry verification" (jwks mode) — same rationale as
// hs256-jwt.verifier.spec.ts: auth.guard.spec.ts mocks `JwtVerifier` above
// this layer, so this file's own `jose` wiring is otherwise untested.
//
// `createRemoteJWKSet` is mocked to a `createLocalJWKSet` built from a
// key pair generated in-process — this exercises the exact same
// `jwtVerify(token, this.jwks, {...})` verification path with real
// signatures, without making a network call in a unit test. What
// `createRemoteJWKSet` itself does (HTTP fetch, key-rotation caching) is
// `jose`'s own tested behavior, not this file's responsibility.

jest.mock('jose', () => {
  const actual = jest.requireActual<typeof import('jose')>('jose');
  return { ...actual, createRemoteJWKSet: jest.fn() };
});

const mockedCreateRemoteJWKSet = createRemoteJWKSet as jest.MockedFunction<
  typeof createRemoteJWKSet
>;

const ISSUER = 'https://issuer.test';
const AUDIENCE = 'core-api';
const JWKS_URL = 'https://issuer.test/.well-known/jwks.json';
const SUBJECT = '22222222-2222-2222-2222-222222222222';
const KID = 'unit-test-key';

let privateKey: KeyLike;

beforeAll(async () => {
  const pair = await generateKeyPair('RS256');
  privateKey = pair.privateKey;
  const publicJwk = await exportJWK(pair.publicKey);
  mockedCreateRemoteJWKSet.mockReturnValue(
    createLocalJWKSet({ keys: [{ ...publicJwk, kid: KID, alg: 'RS256' }] }),
  );
});

function buildVerifier(): JwksJwtVerifier {
  // Construction itself calls the mocked `createRemoteJWKSet` above — no
  // network I/O happens here.
  return new JwksJwtVerifier({ jwksUrl: JWKS_URL, issuer: ISSUER, audience: AUDIENCE });
}

async function sign(
  claims: Record<string, unknown>,
  options: {
    issuer?: string;
    audience?: string;
    subject?: string;
    expiresInSeconds?: number;
    key?: KeyLike;
    kid?: string;
  } = {},
): Promise<string> {
  let jwt = new SignJWT(claims)
    .setProtectedHeader({ alg: 'RS256', kid: options.kid ?? KID })
    .setIssuedAt()
    .setIssuer(options.issuer ?? ISSUER)
    .setAudience(options.audience ?? AUDIENCE)
    .setExpirationTime(Math.floor(Date.now() / 1000) + (options.expiresInSeconds ?? 3600));
  if (options.subject !== undefined) {
    jwt = jwt.setSubject(options.subject);
  }
  return jwt.sign(options.key ?? privateKey);
}

describe('JwksJwtVerifier', () => {
  it('resolves the sub claim for a validly signed token', async () => {
    const token = await sign({}, { subject: SUBJECT });

    await expect(buildVerifier().verify(token)).resolves.toEqual({ sub: SUBJECT });
  });

  it('throws InvalidTokenError for a token signed with an unknown key (kid not in the JWKS)', async () => {
    const otherPair = await generateKeyPair('RS256');
    const token = await sign(
      {},
      { subject: SUBJECT, key: otherPair.privateKey, kid: 'not-in-the-jwks' },
    );

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

  it('throws InvalidTokenError when the token has no sub claim', async () => {
    const token = await sign({});

    await expect(buildVerifier().verify(token)).rejects.toBeInstanceOf(InvalidTokenError);
  });
});
