import { randomUUID } from 'node:crypto';
import { INestApplication, ValidationPipe } from '@nestjs/common';
import { Test } from '@nestjs/testing';
import type { ProviderCatalogItem, RefillItem } from '@repon/types';
import { SignJWT } from 'jose';
import request from 'supertest';
import { AppModule } from '../src/app.module';
import {
  CatalogQueryUnavailableError,
  CATALOG_QUERY_PORT,
  type CatalogQueryPort,
} from '../src/domains/catalogo/contracts/catalog-query.port';
import {
  OFFER_OPPORTUNITY_REPOSITORY,
  type OfferOpportunityRepository,
  type OportunidadElegible,
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
import {
  NOTIFICATION_PORT,
  type NotificationPort,
} from '../src/shared/notifications/notification.port';

// core-api-ofertas spec / design.md Diagrama 2 — `enviarOferta` end to end:
// "A non-eligible company is rejected with 404" / "A nonexistent
// refillRequestId is rejected with the same 404" (byte-identical, D11), "An
// offer against a closed opportunity is rejected with 409, not 404" (Q4),
// "A refillItemId from another solicitud is rejected" (400), "A catalog
// outage maps to 503, never a degraded offer" (C8) — mirrors
// `consumo-marcar-dosis.e2e-spec.ts`'s override shape (the closest analog:
// a mutating use case that wraps `runInTransaction` AND publishes after
// commit), extended with `CATALOG_QUERY_PORT`/`OFFER_OPPORTUNITY_REPOSITORY`
// since `EnviarOfertaUseCase` is the first use case in this domain to need
// both a transaction manager AND a `contracts/` port. REAL
// `AuthGuard`/`ValidationPipe`/`OfertasExceptionFilter`; only
// `ACTOR_PORT`/`OFFER_OPPORTUNITY_REPOSITORY`/`OFFER_REPOSITORY`/
// `CATALOG_QUERY_PORT`/`TRANSACTION_MANAGER`/`EVENT_PUBLISHER`/
// `NOTIFICATION_PORT` overridden — no local Supabase/Docker required, same
// convention every `*.e2e-spec.ts` in this repo already follows (PR4b's own
// finding, re-confirmed by PR5a: this repo's e2e convention never touches a
// real database — that class of test is `*.integration-spec.ts` instead).
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

// `EnviarOfertaUseCase`'s step-8 hard rule (design.md D-G.2/PR5a) correlates
// a requested item's catalog match by `catalogProductId` when the
// underlying `RefillItem` carries one — so `refillItemFixture()` and
// `providerCatalogItemFixture()` MUST default to the SAME
// `catalogProductId` to represent "the provider's catalog genuinely
// carries this product" (mirrors `enviar-oferta.use-case.spec.ts`'s own
// fixtures, both hardcoding the identical `'catalog-product-a'` literal for
// the same reason). Independently randomizing each fixture's
// `catalogProductId` would make every happy-path call fail the hard rule by
// construction — a real fixture bug caught by actually running this e2e
// spec, not a bug in the use case itself.
const DEFAULT_CATALOG_PRODUCT_ID = randomUUID();

function refillItemFixture(overrides: Partial<RefillItem> = {}): RefillItem {
  return {
    id: randomUUID(),
    nombre: 'Alimento perro',
    categoria: 'alimento',
    precioReferencia: 12990,
    catalogProductId: DEFAULT_CATALOG_PRODUCT_ID,
    ...overrides,
  };
}

function oportunidadFixture(overrides: Partial<OportunidadElegible> = {}): OportunidadElegible {
  return {
    refillRequestId: randomUUID(),
    userId: randomUUID(),
    comuna: 'Providencia',
    urgencia: 'hoy',
    cerradaAt: null,
    items: [refillItemFixture()],
    ...overrides,
  };
}

function providerCatalogItemFixture(
  overrides: Partial<ProviderCatalogItem> = {},
): ProviderCatalogItem {
  return {
    id: randomUUID(),
    companyId: randomUUID(),
    catalogProductId: DEFAULT_CATALOG_PRODUCT_ID,
    nombre: 'Alimento perro',
    categoria: 'alimento',
    precioBase: 10990,
    precioMaximo: 12990,
    stock: 10,
    disponible: true,
    ...overrides,
  };
}

function validBody(refillItemId: string, refillRequestId: string) {
  return {
    refillRequestId,
    items: [{ refillItemId, precio: 11990, isAlt: false }],
    entrega: { tiempoEntregaHoras: 24, costoDespacho: 2000 },
  };
}

describe('Ofertas — POST /ofertas (e2e)', () => {
  let app: INestApplication;
  let actorPort: jest.Mocked<ActorPort>;
  let opportunityRepository: jest.Mocked<OfferOpportunityRepository>;
  let offerRepository: jest.Mocked<OfferRepository>;
  let catalogQueryPort: jest.Mocked<CatalogQueryPort>;
  let transactionManager: jest.Mocked<TransactionManager>;
  let eventPublisher: jest.Mocked<EventPublisher>;
  let notificationPort: jest.Mocked<NotificationPort>;

  beforeAll(async () => {
    actorPort = { findActorById: jest.fn() };
    opportunityRepository = {
      reemplazar: jest.fn(),
      findElegible: jest.fn(),
      listarPorCompany: jest.fn(),
      existeRelacion: jest.fn(),
      cerrar: jest.fn(),
    };
    offerRepository = {
      save: jest.fn().mockResolvedValue(undefined),
      findById: jest.fn(),
      findByUser: jest.fn(),
      findByRefillRequest: jest.fn(),
      marcarAceptada: jest.fn(),
      desplazarHermanas: jest.fn(),
    };
    catalogQueryPort = { buscarCoincidencias: jest.fn().mockResolvedValue([]) };
    const fakeTx = {} as TransactionContext;
    transactionManager = {
      runInTransaction: jest.fn().mockImplementation((work) => work(fakeTx)),
    };
    eventPublisher = { publish: jest.fn().mockResolvedValue(undefined) };
    notificationPort = { sendPush: jest.fn().mockResolvedValue(undefined) };

    const moduleRef = await Test.createTestingModule({ imports: [AppModule] })
      .overrideProvider(ACTOR_PORT)
      .useValue(actorPort)
      .overrideProvider(OFFER_OPPORTUNITY_REPOSITORY)
      .useValue(opportunityRepository)
      .overrideProvider(OFFER_REPOSITORY)
      .useValue(offerRepository)
      .overrideProvider(CATALOG_QUERY_PORT)
      .useValue(catalogQueryPort)
      .overrideProvider(TRANSACTION_MANAGER)
      .useValue(transactionManager)
      .overrideProvider(EVENT_PUBLISHER)
      .useValue(eventPublisher)
      .overrideProvider(NOTIFICATION_PORT)
      .useValue(notificationPort)
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

  it('201s, persists the offer inside one transaction, and returns OfferResponseDto — happy path', async () => {
    const profileId = randomUUID();
    const companyId = randomUUID();
    const userId = randomUUID();
    const refillItemId = randomUUID();
    const refillRequestId = randomUUID();
    actorPort.findActorById.mockResolvedValueOnce(buildProviderActor({ profileId, companyId }));
    opportunityRepository.findElegible.mockResolvedValueOnce(
      oportunidadFixture({
        refillRequestId,
        userId,
        items: [refillItemFixture({ id: refillItemId })],
      }),
    );
    catalogQueryPort.buscarCoincidencias.mockResolvedValueOnce([providerCatalogItemFixture()]);
    const token = await signToken(profileId);

    const res = await request(app.getHttpServer())
      .post('/ofertas')
      .set('Authorization', `Bearer ${token}`)
      .send(validBody(refillItemId, refillRequestId))
      .expect(201);

    expect(res.body).toMatchObject({
      userId,
      companyId,
      status: 'pendiente',
      kind: 'reactiva',
      refillRequestId,
      total: 11990 + 2000,
    });
    expect(res.body.items).toHaveLength(1);
    expect(res.body.items[0]).toMatchObject({ refillItemId, precio: 11990, isAlt: false });

    // `runInTransaction` wraps exactly one `save()` call (design.md D13
    // paso 10) — asserted at the repository-mock boundary, same convention
    // `refill-crear-solicitud.e2e-spec.ts`/`consumo-marcar-dosis.e2e-spec.ts`
    // already use.
    expect(offerRepository.save).toHaveBeenCalledTimes(1);
    expect(offerRepository.save).toHaveBeenCalledWith(
      expect.objectContaining({ userId, companyId, refillRequestId }),
      expect.anything(),
    );
    expect(eventPublisher.publish).toHaveBeenCalledTimes(1);
    expect(notificationPort.sendPush).toHaveBeenCalledWith(userId, expect.any(String));
  });

  it(
    'returns 404 SOLICITUD_NO_ELEGIBLE for a non-eligible company, byte-identical to a ' +
      'nonexistent refillRequestId (D11) — the repository already collapses both causes into ' +
      'the same null return, so 2 requests against the same refillRequestId (one standing in ' +
      "for 'not eligible', the other for 'does not exist') produce IDENTICAL response bodies, " +
      'never distinguishable by the client',
    async () => {
      const profileId = randomUUID();
      const companyId = randomUUID();
      const refillItemId = randomUUID();
      const refillRequestId = randomUUID();
      actorPort.findActorById.mockResolvedValue(buildProviderActor({ profileId, companyId }));
      opportunityRepository.findElegible.mockResolvedValue(null);
      const token = await signToken(profileId);

      const resA = await request(app.getHttpServer())
        .post('/ofertas')
        .set('Authorization', `Bearer ${token}`)
        .send(validBody(refillItemId, refillRequestId))
        .expect(404);

      const resB = await request(app.getHttpServer())
        .post('/ofertas')
        .set('Authorization', `Bearer ${token}`)
        .send(validBody(refillItemId, refillRequestId))
        .expect(404);

      expect(resA.body).toMatchObject({ statusCode: 404, code: 'SOLICITUD_NO_ELEGIBLE' });
      expect(resA.body).toEqual(resB.body);
      expect(offerRepository.save).not.toHaveBeenCalled();
      expect(catalogQueryPort.buscarCoincidencias).not.toHaveBeenCalled();
    },
  );

  it('returns 409 OFERTA_OPORTUNIDAD_CERRADA for a closed opportunity, and persists nothing', async () => {
    const profileId = randomUUID();
    const companyId = randomUUID();
    const refillItemId = randomUUID();
    const refillRequestId = randomUUID();
    actorPort.findActorById.mockResolvedValueOnce(buildProviderActor({ profileId, companyId }));
    opportunityRepository.findElegible.mockResolvedValueOnce(
      oportunidadFixture({
        refillRequestId,
        cerradaAt: '2026-08-01T12:00:00.000Z',
        items: [refillItemFixture({ id: refillItemId })],
      }),
    );
    const token = await signToken(profileId);

    const res = await request(app.getHttpServer())
      .post('/ofertas')
      .set('Authorization', `Bearer ${token}`)
      .send(validBody(refillItemId, refillRequestId))
      .expect(409);

    expect(res.body).toMatchObject({ statusCode: 409, code: 'OFERTA_OPORTUNIDAD_CERRADA' });
    expect(catalogQueryPort.buscarCoincidencias).not.toHaveBeenCalled();
    expect(offerRepository.save).not.toHaveBeenCalled();
  });

  it('returns 400 OFERTA_INVALIDA for a refillItemId foreign to the solicitud, and persists nothing', async () => {
    const profileId = randomUUID();
    const companyId = randomUUID();
    const refillRequestId = randomUUID();
    actorPort.findActorById.mockResolvedValueOnce(buildProviderActor({ profileId, companyId }));
    opportunityRepository.findElegible.mockResolvedValueOnce(
      oportunidadFixture({ refillRequestId, items: [refillItemFixture()] }),
    );
    const token = await signToken(profileId);

    const res = await request(app.getHttpServer())
      .post('/ofertas')
      .set('Authorization', `Bearer ${token}`)
      .send(validBody(randomUUID(), refillRequestId))
      .expect(400);

    expect(res.body).toMatchObject({ statusCode: 400, code: 'OFERTA_INVALIDA' });
    expect(catalogQueryPort.buscarCoincidencias).not.toHaveBeenCalled();
    expect(offerRepository.save).not.toHaveBeenCalled();
  });

  it(
    'returns 503 CATALOG_UNAVAILABLE when the catalog port rejects, and the offer is NEVER ' +
      'persisted (C8: no degraded offer)',
    async () => {
      const profileId = randomUUID();
      const companyId = randomUUID();
      const refillItemId = randomUUID();
      const refillRequestId = randomUUID();
      actorPort.findActorById.mockResolvedValueOnce(buildProviderActor({ profileId, companyId }));
      opportunityRepository.findElegible.mockResolvedValueOnce(
        oportunidadFixture({ refillRequestId, items: [refillItemFixture({ id: refillItemId })] }),
      );
      catalogQueryPort.buscarCoincidencias.mockRejectedValueOnce(
        new CatalogQueryUnavailableError(),
      );
      const token = await signToken(profileId);

      const res = await request(app.getHttpServer())
        .post('/ofertas')
        .set('Authorization', `Bearer ${token}`)
        .send(validBody(refillItemId, refillRequestId))
        .expect(503);

      expect(res.body).toMatchObject({ statusCode: 503, code: 'CATALOG_UNAVAILABLE' });
      expect(transactionManager.runInTransaction).not.toHaveBeenCalled();
      expect(offerRepository.save).not.toHaveBeenCalled();
      expect(eventPublisher.publish).not.toHaveBeenCalled();
    },
  );

  it('rejects an unauthenticated request with 401', () => {
    return request(app.getHttpServer())
      .post('/ofertas')
      .send(validBody(randomUUID(), randomUUID()))
      .expect(401)
      .expect((res) => {
        expect(res.body).toMatchObject({ statusCode: 401, code: 'MISSING_BEARER_TOKEN' });
      });
  });

  it("rejects a non-provider actor (role 'user') with 403 ROLE_NOT_ALLOWED, and persists nothing", async () => {
    const profileId = randomUUID();
    actorPort.findActorById.mockResolvedValueOnce(buildUserActor(profileId));
    const token = await signToken(profileId);

    const res = await request(app.getHttpServer())
      .post('/ofertas')
      .set('Authorization', `Bearer ${token}`)
      .send(validBody(randomUUID(), randomUUID()))
      .expect(403);

    expect(res.body).toMatchObject({ statusCode: 403, code: 'ROLE_NOT_ALLOWED' });
    expect(opportunityRepository.findElegible).not.toHaveBeenCalled();
    expect(offerRepository.save).not.toHaveBeenCalled();
  });
});
