import { randomUUID } from 'node:crypto';
import { INestApplication, ValidationPipe } from '@nestjs/common';
import { Test } from '@nestjs/testing';
import type { Offer } from '@repon/types';
import { SignJWT } from 'jose';
import request from 'supertest';
import { AppModule } from '../src/app.module';
import {
  OFFER_REPOSITORY,
  type OfferRepository,
} from '../src/domains/ofertas/ports-out/offer-repository.port';
import { GlobalExceptionFilter } from '../src/shared/auth/global-exception.filter';
import {
  ACTOR_PORT,
  type ActorPort,
  type AuthenticatedActor,
} from '../src/shared/auth/ports/actor.port';

// core-api-ofertas spec / design.md Diagrama 1 — `obtenerBandeja` end to
// end (task 7b.6): "obtenerBandeja never returns another user's offers" /
// "The bandeja includes items without a second request" (already unit-
// proven in PR7a's `obtener-bandeja.use-case.spec.ts`; this file proves the
// HTTP wiring on top: `@Roles('user')`, `actor.profileId` extraction,
// `toOfferResponseDto` mapping). Same override shape as every prior
// `ofertas` e2e spec — REAL `AuthGuard`/`RolesGuard`/`ValidationPipe`/
// `OfertasExceptionFilter`; only `ACTOR_PORT`/`OFFER_REPOSITORY` overridden
// — no local Supabase/Docker required. tasks.md 7b.6 names exactly 2
// scenarios (200 own-offers-with-items-inline; 401) — this file implements
// exactly those 2, no more, matching the task's own narrower scope (unlike
// 4b.7's larger enumerated set for `listarSolicitudesElegibles`).
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

function buildUserActor(profileId: string): AuthenticatedActor {
  return {
    profileId,
    role: 'user',
    status: 'activo',
    companyId: null,
    companyStatus: null,
    adminRole: null,
  };
}

function offerFixture(overrides: Partial<Extract<Offer, { kind: 'reactiva' }>> = {}): Offer {
  return {
    id: randomUUID(),
    userId: randomUUID(),
    companyId: randomUUID(),
    status: 'pendiente',
    tiempoEntregaHoras: 24,
    costoDespacho: 2000,
    total: 13990,
    kind: 'reactiva',
    refillRequestId: randomUUID(),
    items: [{ refillItemId: randomUUID(), precio: 11990, isAlt: false }],
    ...overrides,
  };
}

describe('Ofertas — GET /ofertas/bandeja (e2e)', () => {
  let app: INestApplication;
  let actorPort: jest.Mocked<ActorPort>;
  let offerRepository: jest.Mocked<OfferRepository>;

  beforeAll(async () => {
    actorPort = { findActorById: jest.fn() };
    offerRepository = {
      save: jest.fn(),
      findById: jest.fn(),
      findByUser: jest.fn(),
      findByRefillRequest: jest.fn(),
      marcarAceptada: jest.fn(),
      desplazarHermanas: jest.fn(),
    };

    const moduleRef = await Test.createTestingModule({ imports: [AppModule] })
      .overrideProvider(ACTOR_PORT)
      .useValue(actorPort)
      .overrideProvider(OFFER_REPOSITORY)
      .useValue(offerRepository)
      .compile();

    app = moduleRef.createNestApplication();
    // Mirrors main.ts's real bootstrap wiring.
    app.useGlobalPipes(
      new ValidationPipe({ whitelist: true, forbidNonWhitelisted: true, transform: true }),
    );
    app.useGlobalFilters(new GlobalExceptionFilter());
    await app.init();
  });

  afterEach(() => jest.clearAllMocks());

  afterAll(async () => {
    await app.close();
  });

  it(
    "returns 200 with only the actor's own offers, items inline, mapped through " +
      'toOfferResponseDto (task 7b.6)',
    async () => {
      const profileId = randomUUID();
      const offers = [offerFixture({ userId: profileId }), offerFixture({ userId: profileId })];
      actorPort.findActorById.mockResolvedValueOnce(buildUserActor(profileId));
      offerRepository.findByUser.mockResolvedValueOnce(offers);
      const token = await signToken(profileId);

      const res = await request(app.getHttpServer())
        .get('/ofertas/bandeja')
        .set('Authorization', `Bearer ${token}`)
        .expect(200);

      expect(offerRepository.findByUser).toHaveBeenCalledTimes(1);
      expect(offerRepository.findByUser).toHaveBeenCalledWith(profileId);
      expect(res.body).toEqual(
        offers.map((offer) => ({
          id: offer.id,
          userId: offer.userId,
          companyId: offer.companyId,
          status: offer.status,
          kind: offer.kind,
          refillRequestId: offer.refillRequestId,
          tiempoEntregaHoras: offer.tiempoEntregaHoras,
          costoDespacho: offer.costoDespacho,
          total: offer.total,
          items: offer.items.map((item) => ({ ...item })),
        })),
      );
    },
  );

  it('returns 200 with an empty array when the actor has zero offers', async () => {
    const profileId = randomUUID();
    actorPort.findActorById.mockResolvedValueOnce(buildUserActor(profileId));
    offerRepository.findByUser.mockResolvedValueOnce([]);
    const token = await signToken(profileId);

    const res = await request(app.getHttpServer())
      .get('/ofertas/bandeja')
      .set('Authorization', `Bearer ${token}`)
      .expect(200);

    expect(res.body).toEqual([]);
  });

  it('rejects an unauthenticated request with 401', () => {
    return request(app.getHttpServer())
      .get('/ofertas/bandeja')
      .expect(401)
      .expect((res) => {
        expect(res.body).toMatchObject({ statusCode: 401, code: 'MISSING_BEARER_TOKEN' });
      });
  });
});
