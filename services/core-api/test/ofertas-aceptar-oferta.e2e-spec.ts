import { randomUUID } from 'node:crypto';
import { INestApplication, ValidationPipe } from '@nestjs/common';
import { Test } from '@nestjs/testing';
import type { Offer } from '@repon/types';
import { SignJWT } from 'jose';
import request from 'supertest';
import { AppModule } from '../src/app.module';
import { OfertaYaAceptadaError } from '../src/domains/ofertas/domain/oferta.errors';
import { OfertaAceptada } from '../src/domains/ofertas/events/oferta-aceptada.event';
import {
  OFFER_OPPORTUNITY_REPOSITORY,
  type OfferOpportunityRepository,
} from '../src/domains/ofertas/ports-out/offer-opportunity-repository.port';
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
import {
  TRANSACTION_MANAGER,
  type TransactionContext,
  type TransactionManager,
} from '../src/shared/database/transaction';
import { EVENT_PUBLISHER, type EventPublisher } from '../src/shared/event-bus/event-publisher.port';

// core-api-ofertas spec / design.md D-D — `aceptarOferta` end to end:
// "User A cannot accept user B's offer" / "A nonexistent offerId is rejected
// with the same 404" (byte-identical, D11), "an owned offer whose status is
// not 'pendiente' is rejected with 409" (D-G.3), "a double-tap race maps to
// 409, never 500" (R4), "accepting a proactive offer displaces nothing and
// closes nothing" (D12). Same override shape as every prior `ofertas` e2e
// spec — REAL `AuthGuard`/`RolesGuard`/`ValidationPipe`/
// `OfertasExceptionFilter`; only `ACTOR_PORT`/`OFFER_REPOSITORY`/
// `OFFER_OPPORTUNITY_REPOSITORY`/`TRANSACTION_MANAGER`/`EVENT_PUBLISHER`
// overridden — no local Supabase/Docker required.
//
// **The "409 double-tap" scenario is simulated, not raced.** tasks.md 7b.5's
// own wording ("2 near-simultaneous requests on 2 sibling offers of the same
// R") describes the scenario `OfertaYaAceptadaError`/the partial unique
// index `offers_refill_request_id_aceptada_uidx` actually protects against —
// TWO DIFFERENT sibling offers of the same `refillRequestId` both racing to
// become `'aceptada'`. That race lives entirely inside a real Postgres
// transaction (`KyselyOfferRepository.marcarAceptada`'s own `23505`
// translation, already unit-tested in PR3a) and this e2e suite's own
// override convention — mocking `OFFER_REPOSITORY` — makes 2 genuinely
// concurrent HTTP requests land on 2 in-memory jest mocks, not 2 rows in a
// real table, so it cannot exercise the actual race condition. What THIS
// test proves instead — the only thing this layer (use case + HTTP) is
// responsible for — is that the use case propagates whatever
// `OfertaYaAceptadaError` the adapter throws, uncaught, and the HTTP filter
// maps it to 409, never 500: `marcarAceptada` is mocked to reject with the
// exact error the adapter's own translation would produce, standing in for
// "the second of the 2 sibling requests reached the adapter and lost the
// race." This is NOT the same as PR7a's own review finding (documented in
// this change's apply-progress.md, "Orchestrator Review Notes (PR7a)") about
// the SAME offer being double-accepted twice concurrently — that narrower
// gap (missing `WHERE status = 'pendiente'` guard on `marcarAceptada`'s
// UPDATE) is out of this PR's scope, flagged there, not re-litigated or
// fixed here.
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

function buildProviderActor(
  overrides: Partial<AuthenticatedActor> & { profileId: string; companyId: string },
): AuthenticatedActor {
  return {
    role: 'provider',
    status: 'activo',
    companyStatus: 'activo',
    adminRole: null,
    ...overrides,
  };
}

type OfferReactiva = Extract<Offer, { kind: 'reactiva' }>;
type OfferProactiva = Extract<Offer, { kind: 'proactiva' }>;

function offerReactivaFixture(overrides: Partial<OfferReactiva> = {}): OfferReactiva {
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
    items: [
      {
        id: randomUUID(),
        nombre: 'Agua 20L',
        refillItemId: randomUUID(),
        precio: 11990,
        isAlt: false,
      },
    ],
    ...overrides,
  };
}

function offerProactivaFixture(overrides: Partial<OfferProactiva> = {}): OfferProactiva {
  return {
    id: randomUUID(),
    userId: randomUUID(),
    companyId: randomUUID(),
    status: 'pendiente',
    tiempoEntregaHoras: 24,
    costoDespacho: 2000,
    total: 13990,
    kind: 'proactiva',
    items: [
      {
        id: randomUUID(),
        nombre: 'Bidón 10L',
        providerCatalogItemId: randomUUID(),
        precio: 11990,
        isAlt: false,
      },
    ],
    ...overrides,
  };
}

describe('Ofertas — POST /ofertas/:offerId/aceptar (e2e)', () => {
  let app: INestApplication;
  let actorPort: jest.Mocked<ActorPort>;
  let offerRepository: jest.Mocked<OfferRepository>;
  let opportunityRepository: jest.Mocked<OfferOpportunityRepository>;
  let transactionManager: jest.Mocked<TransactionManager>;
  let eventPublisher: jest.Mocked<EventPublisher>;

  beforeAll(async () => {
    actorPort = { findActorById: jest.fn() };
    offerRepository = {
      save: jest.fn(),
      findById: jest.fn(),
      findByUser: jest.fn(),
      findByRefillRequest: jest.fn(),
      marcarAceptada: jest.fn().mockResolvedValue(undefined),
      desplazarHermanas: jest.fn().mockResolvedValue([]),
    };
    opportunityRepository = {
      reemplazar: jest.fn(),
      findElegible: jest.fn(),
      listarPorCompany: jest.fn(),
      existeRelacion: jest.fn(),
      cerrar: jest.fn().mockResolvedValue(undefined),
    };
    const fakeTx = {} as TransactionContext;
    transactionManager = {
      runInTransaction: jest.fn().mockImplementation((work) => work(fakeTx)),
    };
    eventPublisher = { publish: jest.fn().mockResolvedValue(undefined) };

    const moduleRef = await Test.createTestingModule({ imports: [AppModule] })
      .overrideProvider(ACTOR_PORT)
      .useValue(actorPort)
      .overrideProvider(OFFER_REPOSITORY)
      .useValue(offerRepository)
      .overrideProvider(OFFER_OPPORTUNITY_REPOSITORY)
      .useValue(opportunityRepository)
      .overrideProvider(TRANSACTION_MANAGER)
      .useValue(transactionManager)
      .overrideProvider(EVENT_PUBLISHER)
      .useValue(eventPublisher)
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
    '204s, marks the offer aceptada, displaces its pending siblings to rechazada, closes the ' +
      'opportunity, and publishes OfertaAceptada with the exact desplazadas — happy path (reactiva)',
    async () => {
      const profileId = randomUUID();
      const offerId = randomUUID();
      const refillRequestId = randomUUID();
      actorPort.findActorById.mockResolvedValueOnce(buildUserActor(profileId));
      offerRepository.findById.mockResolvedValueOnce(
        offerReactivaFixture({ id: offerId, userId: profileId, refillRequestId }),
      );
      offerRepository.desplazarHermanas.mockResolvedValueOnce(['sibling-1', 'sibling-2']);
      const token = await signToken(profileId);

      await request(app.getHttpServer())
        .post(`/ofertas/${offerId}/aceptar`)
        .set('Authorization', `Bearer ${token}`)
        .expect(204);

      expect(offerRepository.marcarAceptada).toHaveBeenCalledWith(offerId, expect.anything());
      expect(offerRepository.desplazarHermanas).toHaveBeenCalledWith(
        refillRequestId,
        offerId,
        expect.anything(),
      );
      expect(opportunityRepository.cerrar).toHaveBeenCalledWith(refillRequestId, expect.anything());
      expect(eventPublisher.publish).toHaveBeenCalledTimes(1);
      const [publishedEvent] = eventPublisher.publish.mock.calls[0] as [OfertaAceptada];
      expect(publishedEvent).toBeInstanceOf(OfertaAceptada);
      expect(publishedEvent.type).toBe('ofertas.oferta_aceptada');
      expect(publishedEvent.payload).toMatchObject({
        offerId,
        refillRequestId,
        desplazadas: ['sibling-1', 'sibling-2'],
      });
    },
  );

  it(
    'returns 404 OFFER_NOT_FOUND with a byte-identical body whether the offer belongs to ' +
      'another user or does not exist at all (D11) — same offerId used for both requests',
    async () => {
      const profileId = randomUUID();
      const offerId = randomUUID();

      actorPort.findActorById.mockResolvedValueOnce(buildUserActor(profileId));
      offerRepository.findById.mockResolvedValueOnce(
        offerReactivaFixture({ id: offerId, userId: randomUUID() }),
      );
      const tokenCrossTenant = await signToken(profileId);
      const resCrossTenant = await request(app.getHttpServer())
        .post(`/ofertas/${offerId}/aceptar`)
        .set('Authorization', `Bearer ${tokenCrossTenant}`)
        .expect(404);

      actorPort.findActorById.mockResolvedValueOnce(buildUserActor(profileId));
      offerRepository.findById.mockResolvedValueOnce(null);
      const tokenNonexistent = await signToken(profileId);
      const resNonexistent = await request(app.getHttpServer())
        .post(`/ofertas/${offerId}/aceptar`)
        .set('Authorization', `Bearer ${tokenNonexistent}`)
        .expect(404);

      expect(resCrossTenant.body).toEqual(resNonexistent.body);
      expect(resCrossTenant.body).toEqual({
        statusCode: 404,
        code: 'OFFER_NOT_FOUND',
        message: `Oferta ${offerId} no encontrada.`,
      });
      expect(offerRepository.marcarAceptada).not.toHaveBeenCalled();
    },
  );

  it(
    'returns 409 TRANSICION_INVALIDA when the offer exists and is owned, but its own status is ' +
      "not 'pendiente' (D-G.3)",
    async () => {
      const profileId = randomUUID();
      const offerId = randomUUID();
      actorPort.findActorById.mockResolvedValueOnce(buildUserActor(profileId));
      offerRepository.findById.mockResolvedValueOnce(
        offerReactivaFixture({ id: offerId, userId: profileId, status: 'aceptada' }),
      );
      const token = await signToken(profileId);

      const res = await request(app.getHttpServer())
        .post(`/ofertas/${offerId}/aceptar`)
        .set('Authorization', `Bearer ${token}`)
        .expect(409);

      expect(res.body).toMatchObject({ statusCode: 409, code: 'TRANSICION_INVALIDA' });
      expect(offerRepository.marcarAceptada).not.toHaveBeenCalled();
      expect(eventPublisher.publish).not.toHaveBeenCalled();
    },
  );

  it(
    "returns 409 OFERTA_YA_ACEPTADA when marcarAceptada rejects with the adapter's own " +
      '23505-translation (R4) — simulating the losing side of a double-tap race on 2 sibling ' +
      'offers of the same solicitud, never 500',
    async () => {
      const profileId = randomUUID();
      const offerId = randomUUID();
      actorPort.findActorById.mockResolvedValueOnce(buildUserActor(profileId));
      offerRepository.findById.mockResolvedValueOnce(
        offerReactivaFixture({ id: offerId, userId: profileId }),
      );
      offerRepository.marcarAceptada.mockRejectedValueOnce(new OfertaYaAceptadaError(offerId));
      const token = await signToken(profileId);

      const res = await request(app.getHttpServer())
        .post(`/ofertas/${offerId}/aceptar`)
        .set('Authorization', `Bearer ${token}`)
        .expect(409);

      expect(res.body).toMatchObject({ statusCode: 409, code: 'OFERTA_YA_ACEPTADA' });
      expect(offerRepository.desplazarHermanas).not.toHaveBeenCalled();
      expect(opportunityRepository.cerrar).not.toHaveBeenCalled();
      expect(eventPublisher.publish).not.toHaveBeenCalled();
    },
  );

  it(
    '204s for a proactiva offer and touches NEITHER desplazarHermanas NOR cerrar (D12, ' +
      'core-api-ofertas Scenario "Accepting a proactive offer displaces nothing and closes nothing")',
    async () => {
      const profileId = randomUUID();
      const offerId = randomUUID();
      actorPort.findActorById.mockResolvedValueOnce(buildUserActor(profileId));
      offerRepository.findById.mockResolvedValueOnce(
        offerProactivaFixture({ id: offerId, userId: profileId }),
      );
      const token = await signToken(profileId);

      await request(app.getHttpServer())
        .post(`/ofertas/${offerId}/aceptar`)
        .set('Authorization', `Bearer ${token}`)
        .expect(204);

      expect(offerRepository.marcarAceptada).toHaveBeenCalledWith(offerId, expect.anything());
      expect(offerRepository.desplazarHermanas).not.toHaveBeenCalled();
      expect(opportunityRepository.cerrar).not.toHaveBeenCalled();
      const [publishedEvent] = eventPublisher.publish.mock.calls[0] as [OfertaAceptada];
      expect(publishedEvent.payload).toMatchObject({ refillRequestId: null, desplazadas: [] });
    },
  );

  it('rejects an unauthenticated request with 401', () => {
    return request(app.getHttpServer())
      .post(`/ofertas/${randomUUID()}/aceptar`)
      .expect(401)
      .expect((res) => {
        expect(res.body).toMatchObject({ statusCode: 401, code: 'MISSING_BEARER_TOKEN' });
      });
  });

  it("rejects a provider actor (role 'provider') with 403 ROLE_NOT_ALLOWED, and persists nothing", async () => {
    const profileId = randomUUID();
    const companyId = randomUUID();
    actorPort.findActorById.mockResolvedValueOnce(buildProviderActor({ profileId, companyId }));
    const token = await signToken(profileId);

    const res = await request(app.getHttpServer())
      .post(`/ofertas/${randomUUID()}/aceptar`)
      .set('Authorization', `Bearer ${token}`)
      .expect(403);

    expect(res.body).toMatchObject({ statusCode: 403, code: 'ROLE_NOT_ALLOWED' });
    expect(offerRepository.findById).not.toHaveBeenCalled();
  });
});
