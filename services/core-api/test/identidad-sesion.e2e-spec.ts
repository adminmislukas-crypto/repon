import { randomUUID } from 'node:crypto';
import { INestApplication, ValidationPipe } from '@nestjs/common';
import { Test } from '@nestjs/testing';
import type { Profile } from '@repon/types';
import { SignJWT } from 'jose';
import request from 'supertest';
import { AppModule } from '../src/app.module';
import {
  ADMIN_ROLE_REPOSITORY,
  type AdminRoleRepository,
} from '../src/domains/identidad/ports-out/admin-role-repository.port';
import {
  AUTH_PROVIDER,
  AuthProviderAmbiguousError,
  AuthProviderDeterministicError,
  type AuthProvider,
  type AuthSession,
} from '../src/domains/identidad/ports-out/auth-provider.port';
import {
  COMPANY_REPOSITORY,
  type CompanyRepository,
} from '../src/domains/identidad/ports-out/company-repository.port';
import {
  PROFILE_REPOSITORY,
  type ProfileRepository,
} from '../src/domains/identidad/ports-out/profile-repository.port';
import { AUDIT_LOG_PORT, type AuditLogPort } from '../src/shared/audit/audit-log.port';
import {
  TRANSACTION_MANAGER,
  type TransactionContext,
  type TransactionManager,
} from '../src/shared/database/transaction';
import { EVENT_PUBLISHER, type EventPublisher } from '../src/shared/event-bus/event-publisher.port';
import {
  ACTOR_PORT,
  type ActorPort,
  type AuthenticatedActor,
} from '../src/shared/auth/ports/actor.port';
import { GlobalExceptionFilter } from '../src/shared/auth/global-exception.filter';

// Same HS256 secret/issuer/audience as test/env.e2e-setup.ts and
// identidad.e2e-spec.ts, so a token signed here verifies through the real
// Hs256JwtVerifier — each e2e spec file is self-contained (established
// convention, not shared test-util imports across spec files).
const JWT_SECRET = 'test-secret';
const JWT_ISSUER = 'http://127.0.0.1:54321/auth/v1';
const JWT_AUDIENCE = 'authenticated';

async function signToken(sub: string): Promise<string> {
  const key = new TextEncoder().encode(JWT_SECRET);
  return new SignJWT({})
    .setProtectedHeader({ alg: 'HS256' })
    .setSubject(sub)
    .setIssuedAt()
    .setIssuer(JWT_ISSUER)
    .setAudience(JWT_AUDIENCE)
    .setExpirationTime('1h')
    .sign(key);
}

async function buildSession(userId: string): Promise<AuthSession> {
  return {
    accessToken: await signToken(userId),
    refreshToken: `refresh-${userId}`,
    expiresAt: Math.floor(Date.now() / 1000) + 3600,
    userId,
  };
}

function buildActor(overrides: Partial<AuthenticatedActor> & { profileId: string }): AuthenticatedActor {
  return {
    role: 'user',
    status: 'activo',
    companyId: null,
    companyStatus: null,
    adminRole: null,
    ...overrides,
  };
}

function buildProfile(overrides: Partial<Profile> & { id: string }): Profile {
  return {
    role: 'user',
    status: 'activo',
    nombre: 'Test User',
    email: 'test@example.com',
    ...overrides,
  };
}

interface TestApp {
  app: INestApplication;
  actorPort: jest.Mocked<ActorPort>;
  profileRepository: jest.Mocked<ProfileRepository>;
  authProvider: jest.Mocked<AuthProvider>;
}

/**
 * Same override set as `identidad.e2e-spec.ts` (real `AppModule`, real
 * `AuthGuard`/`RolesGuard`/`RateLimitInterceptor`, only the 6 identidad
 * ports-out + shared-kernel ports mocked) — no local Supabase required.
 * Each top-level `describe` block below gets its OWN app instance (its own
 * `InMemoryRateLimitStore`), deliberately: the login route's per-IP rate
 * counter is shared across every request against the same app, so tests
 * that deliberately drive many failed attempts (lockout scenarios) would
 * contaminate unrelated tests' counters if they all shared one app.
 */
async function createTestApp(): Promise<TestApp> {
  const actorPort: jest.Mocked<ActorPort> = { findActorById: jest.fn() };
  const companyRepository: jest.Mocked<CompanyRepository> = { save: jest.fn(), findById: jest.fn() };
  const profileRepository: jest.Mocked<ProfileRepository> = {
    insertIfAbsent: jest.fn(),
    update: jest.fn(),
    findById: jest.fn(),
  };
  const adminRoleRepository: jest.Mocked<AdminRoleRepository> = {
    upsert: jest.fn(),
    findByProfileId: jest.fn(),
  };
  const authProvider: jest.Mocked<AuthProvider> = {
    createAccount: jest.fn(),
    deleteAccount: jest.fn(),
    findAccountByEmail: jest.fn(),
    signIn: jest.fn(),
    refreshSession: jest.fn(),
    revokeSession: jest.fn(),
  };
  const auditLogPort: jest.Mocked<AuditLogPort> = { record: jest.fn().mockResolvedValue(undefined) };
  const eventPublisher: jest.Mocked<EventPublisher> = { publish: jest.fn().mockResolvedValue(undefined) };
  const fakeTx = {} as TransactionContext;
  const transactionManager: jest.Mocked<TransactionManager> = {
    runInTransaction: jest.fn().mockImplementation((work) => work(fakeTx)),
  };

  const moduleRef = await Test.createTestingModule({ imports: [AppModule] })
    .overrideProvider(ACTOR_PORT)
    .useValue(actorPort)
    .overrideProvider(COMPANY_REPOSITORY)
    .useValue(companyRepository)
    .overrideProvider(PROFILE_REPOSITORY)
    .useValue(profileRepository)
    .overrideProvider(ADMIN_ROLE_REPOSITORY)
    .useValue(adminRoleRepository)
    .overrideProvider(AUTH_PROVIDER)
    .useValue(authProvider)
    .overrideProvider(AUDIT_LOG_PORT)
    .useValue(auditLogPort)
    .overrideProvider(EVENT_PUBLISHER)
    .useValue(eventPublisher)
    .overrideProvider(TRANSACTION_MANAGER)
    .useValue(transactionManager)
    .compile();

  const app = moduleRef.createNestApplication();
  app.useGlobalPipes(new ValidationPipe({ whitelist: true, forbidNonWhitelisted: true, transform: true }));
  app.useGlobalFilters(new GlobalExceptionFilter());
  await app.init();

  return { app, actorPort, profileRepository, authProvider };
}

describe('Identidad sesión — success/error shapes, refresh, logout (e2e)', () => {
  let ctx: TestApp;

  beforeAll(async () => {
    ctx = await createTestApp();
  });

  afterEach(() => jest.clearAllMocks());
  afterAll(() => ctx.app.close());

  it('200s with the SesionResponseDto shape on success', async () => {
    const userId = randomUUID();
    const session = await buildSession(userId);
    ctx.authProvider.signIn.mockResolvedValueOnce(session);
    ctx.actorPort.findActorById.mockResolvedValueOnce(buildActor({ profileId: userId }));
    ctx.profileRepository.findById.mockResolvedValueOnce(buildProfile({ id: userId }));

    const res = await request(ctx.app.getHttpServer())
      .post('/identidad/sesion')
      .send({ email: 'shape@example.com', password: 'correct' })
      .expect(200);

    expect(res.body).toEqual({
      accessToken: session.accessToken,
      refreshToken: session.refreshToken,
      tokenType: 'bearer',
      expiresAt: session.expiresAt,
      perfil: { id: userId, role: 'user', status: 'activo', nombre: 'Test User', email: 'test@example.com' },
    });
  });

  it('wrong password and unknown email produce byte-identical response bodies', async () => {
    ctx.authProvider.signIn.mockRejectedValueOnce(new AuthProviderDeterministicError('invalid_credentials'));
    const wrongPasswordRes = await request(ctx.app.getHttpServer())
      .post('/identidad/sesion')
      .send({ email: 'known-shape@example.com', password: 'wrong' })
      .expect(401);

    ctx.authProvider.signIn.mockRejectedValueOnce(new AuthProviderDeterministicError('invalid_credentials'));
    const unknownEmailRes = await request(ctx.app.getHttpServer())
      .post('/identidad/sesion')
      .send({ email: 'unknown-shape@example.com', password: 'whatever' })
      .expect(401);

    expect(wrongPasswordRes.body).toEqual(unknownEmailRes.body);
    expect(wrongPasswordRes.body).toEqual({
      statusCode: 401,
      code: 'CREDENCIALES_INVALIDAS',
      message: 'Credenciales inválidas.',
    });
  });

  it('an ambiguous AuthProvider failure maps to 503 AUTH_PROVIDER_NO_DISPONIBLE', async () => {
    ctx.authProvider.signIn.mockRejectedValueOnce(new AuthProviderAmbiguousError(new Error('timeout')));

    const res = await request(ctx.app.getHttpServer())
      .post('/identidad/sesion')
      .send({ email: 'outage-1@example.com', password: 'x' })
      .expect(503);

    expect(res.body).toMatchObject({ statusCode: 503, code: 'AUTH_PROVIDER_NO_DISPONIBLE' });
  });

  it('a suspended profile returns 403 with no accessToken/refreshToken anywhere in the body, and revokes', async () => {
    const userId = randomUUID();
    const session = await buildSession(userId);
    ctx.authProvider.signIn.mockResolvedValueOnce(session);
    ctx.actorPort.findActorById.mockResolvedValueOnce(
      buildActor({ profileId: userId, status: 'suspendido' }),
    );

    const res = await request(ctx.app.getHttpServer())
      .post('/identidad/sesion')
      .send({ email: 'suspended-profile@example.com', password: 'correct' })
      .expect(403);

    expect(res.body).toEqual({
      statusCode: 403,
      code: 'PROFILE_SUSPENDED',
      message: 'El perfil está suspendido.',
    });
    expect(JSON.stringify(res.body)).not.toContain('accessToken');
    expect(JSON.stringify(res.body)).not.toContain('refreshToken');
    expect(ctx.authProvider.revokeSession).toHaveBeenCalledWith(session.accessToken);
  });

  it('a suspended-company provider returns 403 with no accessToken/refreshToken anywhere in the body, and revokes', async () => {
    const userId = randomUUID();
    const session = await buildSession(userId);
    ctx.authProvider.signIn.mockResolvedValueOnce(session);
    ctx.actorPort.findActorById.mockResolvedValueOnce(
      buildActor({ profileId: userId, role: 'provider', companyId: 'co-1', companyStatus: 'suspendido' }),
    );

    const res = await request(ctx.app.getHttpServer())
      .post('/identidad/sesion')
      .send({ email: 'suspended-company@example.com', password: 'correct' })
      .expect(403);

    expect(res.body).toEqual({
      statusCode: 403,
      code: 'COMPANY_SUSPENDED',
      message: 'La empresa está suspendida.',
    });
    expect(JSON.stringify(res.body)).not.toContain('accessToken');
    expect(JSON.stringify(res.body)).not.toContain('refreshToken');
    expect(ctx.authProvider.revokeSession).toHaveBeenCalledWith(session.accessToken);
  });

  it('the accessToken from a successful login is accepted by AuthGuard on an authenticated route unmodified', async () => {
    const userId = randomUUID();
    const session = await buildSession(userId);
    ctx.authProvider.signIn.mockResolvedValueOnce(session);
    ctx.actorPort.findActorById
      .mockResolvedValueOnce(buildActor({ profileId: userId })) // resolved inside IniciarSesionUseCase
      .mockResolvedValueOnce(buildActor({ profileId: userId })); // resolved again by AuthGuard on the next request
    ctx.profileRepository.findById.mockResolvedValueOnce(buildProfile({ id: userId }));

    const loginRes = await request(ctx.app.getHttpServer())
      .post('/identidad/sesion')
      .send({ email: 'token-accepted@example.com', password: 'correct' })
      .expect(200);

    ctx.authProvider.revokeSession.mockResolvedValueOnce(undefined);
    await request(ctx.app.getHttpServer())
      .delete('/identidad/sesion')
      .set('Authorization', `Bearer ${loginRes.body.accessToken}`)
      .expect(204);

    // 204, not 401 — AuthGuard verified the GoTrue-issued token exactly like
    // any other token; no guard/verifier change was needed for this PR.
    expect(ctx.authProvider.revokeSession).toHaveBeenCalledWith(session.accessToken);
  });

  it('a burst of outage (ambiguous) failures does not lock anyone out', async () => {
    for (let i = 0; i < 10; i++) {
      ctx.authProvider.signIn.mockRejectedValueOnce(new AuthProviderAmbiguousError(new Error('down')));
      await request(ctx.app.getHttpServer())
        .post('/identidad/sesion')
        .send({ email: `outage-burst-${i}@example.com`, password: 'x' })
        .expect(503);
    }

    const userId = randomUUID();
    ctx.authProvider.signIn.mockResolvedValueOnce(await buildSession(userId));
    ctx.actorPort.findActorById.mockResolvedValueOnce(buildActor({ profileId: userId }));
    ctx.profileRepository.findById.mockResolvedValueOnce(buildProfile({ id: userId }));

    await request(ctx.app.getHttpServer())
      .post('/identidad/sesion')
      .send({ email: 'outage-burst-followup@example.com', password: 'correct' })
      .expect(200);
  });

  it('refresh 200s with the same response shape as login', async () => {
    const userId = randomUUID();
    const session = await buildSession(userId);
    ctx.authProvider.refreshSession.mockResolvedValueOnce(session);
    ctx.actorPort.findActorById.mockResolvedValueOnce(buildActor({ profileId: userId }));
    ctx.profileRepository.findById.mockResolvedValueOnce(buildProfile({ id: userId }));

    const res = await request(ctx.app.getHttpServer())
      .post('/identidad/sesion/refresco')
      .send({ refreshToken: 'old-refresh-token' })
      .expect(200);

    expect(res.body).toMatchObject({ accessToken: session.accessToken, tokenType: 'bearer' });
    expect(ctx.authProvider.refreshSession).toHaveBeenCalledWith('old-refresh-token');
  });

  it('refresh with an expired/reused/rotated-away token maps to 401 SESION_EXPIRADA', async () => {
    ctx.authProvider.refreshSession.mockRejectedValueOnce(
      new AuthProviderDeterministicError('invalid_credentials'),
    );

    const res = await request(ctx.app.getHttpServer())
      .post('/identidad/sesion/refresco')
      .send({ refreshToken: 'stale-token' })
      .expect(401);

    expect(res.body).toMatchObject({ statusCode: 401, code: 'SESION_EXPIRADA' });
  });

  it('logout always returns 204, even when revocation itself fails', async () => {
    const userId = randomUUID();
    const token = await signToken(userId);
    ctx.actorPort.findActorById.mockResolvedValueOnce(buildActor({ profileId: userId }));
    ctx.authProvider.revokeSession.mockRejectedValueOnce(new Error('gotrue down'));

    await request(ctx.app.getHttpServer())
      .delete('/identidad/sesion')
      .set('Authorization', `Bearer ${token}`)
      .expect(204);
  });

  it('logout rejects with 401 when no Authorization header is present', () => {
    return request(ctx.app.getHttpServer()).delete('/identidad/sesion').expect(401);
  });
});

describe('Identidad sesión — per-email lockout (e2e)', () => {
  let ctx: TestApp;

  beforeAll(async () => {
    ctx = await createTestApp();
  });

  afterEach(() => jest.clearAllMocks());
  afterAll(() => ctx.app.close());

  it('locks out after 5 failed attempts for one email — the 6th (even with the correct password) still 429s', async () => {
    const email = 'lockout-known@example.com';
    for (let i = 0; i < 5; i++) {
      ctx.authProvider.signIn.mockRejectedValueOnce(new AuthProviderDeterministicError('invalid_credentials'));
      await request(ctx.app.getHttpServer())
        .post('/identidad/sesion')
        .send({ email, password: 'wrong' })
        .expect(401);
    }

    // A correct password would resolve here, but PRE blocks before signIn
    // is ever invoked — the mock is never consumed.
    ctx.authProvider.signIn.mockResolvedValueOnce(await buildSession(randomUUID()));
    const res = await request(ctx.app.getHttpServer())
      .post('/identidad/sesion')
      .send({ email, password: 'actually-correct-this-time' })
      .expect(429);

    expect(res.body).toMatchObject({ statusCode: 429, code: 'DEMASIADOS_INTENTOS' });
    expect(res.headers['retry-after']).toBeDefined();
    expect(ctx.authProvider.signIn).not.toHaveBeenCalledWith(email, 'actually-correct-this-time');
  });

  it('an unknown email locks out identically to a real one — the 6th attempt also 429s', async () => {
    const email = 'lockout-unknown@example.com';
    for (let i = 0; i < 5; i++) {
      ctx.authProvider.signIn.mockRejectedValueOnce(new AuthProviderDeterministicError('invalid_credentials'));
      await request(ctx.app.getHttpServer())
        .post('/identidad/sesion')
        .send({ email, password: 'whatever' })
        .expect(401);
    }

    const res = await request(ctx.app.getHttpServer())
      .post('/identidad/sesion')
      .send({ email, password: 'still-whatever' })
      .expect(429);

    expect(res.body).toMatchObject({ statusCode: 429, code: 'DEMASIADOS_INTENTOS' });
  });
});

describe('Identidad sesión — reset on success (e2e)', () => {
  let ctx: TestApp;

  beforeAll(async () => {
    ctx = await createTestApp();
  });

  afterEach(() => jest.clearAllMocks());
  afterAll(() => ctx.app.close());

  it('a successful login resets that email counter — 4 fail (under the limit), success, then 5 more needed to re-lock', async () => {
    const email = 'reset-on-success@example.com';

    // Deliberately 4, not 5: at exactly 5 prior failures the email is
    // already locked out (PRE blocks unconditionally, per the "a correct
    // password during an active lockout MUST still be rejected" rule
    // proven in the sibling describe block above) — so a success attempt
    // could never land at all if it arrived after the 5th failure. Reset
    // only has an observable effect when it happens BEFORE the count
    // reaches the limit.
    for (let i = 0; i < 4; i++) {
      ctx.authProvider.signIn.mockRejectedValueOnce(new AuthProviderDeterministicError('invalid_credentials'));
      await request(ctx.app.getHttpServer())
        .post('/identidad/sesion')
        .send({ email, password: 'wrong' })
        .expect(401);
    }

    const userId = randomUUID();
    ctx.authProvider.signIn.mockResolvedValueOnce(await buildSession(userId));
    ctx.actorPort.findActorById.mockResolvedValueOnce(buildActor({ profileId: userId }));
    ctx.profileRepository.findById.mockResolvedValueOnce(buildProfile({ id: userId }));
    await request(ctx.app.getHttpServer())
      .post('/identidad/sesion')
      .send({ email, password: 'correct' })
      .expect(200);

    // 4 more failures since the reset must NOT lock — only 4 of the fresh 5-budget spent.
    for (let i = 0; i < 4; i++) {
      ctx.authProvider.signIn.mockRejectedValueOnce(new AuthProviderDeterministicError('invalid_credentials'));
      await request(ctx.app.getHttpServer())
        .post('/identidad/sesion')
        .send({ email, password: 'wrong-again' })
        .expect(401);
    }

    // 5th failure since the reset — still admitted (count reaches the limit, doesn't yet exceed it).
    ctx.authProvider.signIn.mockRejectedValueOnce(new AuthProviderDeterministicError('invalid_credentials'));
    await request(ctx.app.getHttpServer())
      .post('/identidad/sesion')
      .send({ email, password: 'wrong-again' })
      .expect(401);

    // 6th since the reset — now blocked.
    const res = await request(ctx.app.getHttpServer())
      .post('/identidad/sesion')
      .send({ email, password: 'whatever' })
      .expect(429);
    expect(res.body).toMatchObject({ code: 'DEMASIADOS_INTENTOS' });
  });
});

describe('Identidad sesión — per-IP lockout across many emails (e2e)', () => {
  let ctx: TestApp;

  beforeAll(async () => {
    ctx = await createTestApp();
  });

  afterEach(() => jest.clearAllMocks());
  afterAll(() => ctx.app.close());

  it('locks out after the 21st failed attempt from one IP, spread across 20 distinct emails', async () => {
    // 20 distinct emails, one failure each — no single email comes close to
    // its own 5-per-email budget, isolating this to purely the IP dimension.
    for (let i = 0; i < 20; i++) {
      ctx.authProvider.signIn.mockRejectedValueOnce(new AuthProviderDeterministicError('invalid_credentials'));
      await request(ctx.app.getHttpServer())
        .post('/identidad/sesion')
        .send({ email: `ip-lockout-${i}@example.com`, password: 'wrong' })
        .expect(401);
    }

    const res = await request(ctx.app.getHttpServer())
      .post('/identidad/sesion')
      .send({ email: 'ip-lockout-20@example.com', password: 'wrong' })
      .expect(429);

    expect(res.body).toMatchObject({ statusCode: 429, code: 'DEMASIADOS_INTENTOS' });
  });
});
