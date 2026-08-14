import { randomUUID } from 'node:crypto';
import { INestApplication, ValidationPipe } from '@nestjs/common';
import { Test } from '@nestjs/testing';
import type { ProviderCatalogItem } from '@repon/types';
import { SignJWT } from 'jose';
import request from 'supertest';
import { AppModule } from '../src/app.module';
import {
  CatalogQueryUnavailableError,
  CATALOG_QUERY_PORT,
  type CatalogQueryPort,
} from '../src/domains/catalogo/contracts/catalog-query.port';
import { OfertaEnviada } from '../src/domains/ofertas/events/oferta-enviada.event';
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
import {
  NOTIFICATION_PORT,
  type NotificationPort,
} from '../src/shared/notifications/notification.port';

// core-api-ofertas spec / design.md Diagrama 2, línea 662 — `enviarOfertaProactiva`
// end to end: "A userId with no matching relationship is rejected with 404"
// (D10), "A userId with a prior match qualifies as a recipient", "An id
// belonging to a competitor is rejected, not silently dropped" (D-B
// cardinality), "All items belong to the offering company" (happy path), "A
// catalog outage maps to 503, never a degraded offer" (C8, inherited by
// D-B). Same override shape as `ofertas-enviar-oferta.e2e-spec.ts` (the
// closest analog — this is the same use-case family, TX + `contracts/`
// port), extended for `POST /ofertas/proactivas`. REAL
// `AuthGuard`/`ValidationPipe`/`OfertasExceptionFilter`; only
// `ACTOR_PORT`/`OFFER_OPPORTUNITY_REPOSITORY`/`OFFER_REPOSITORY`/
// `CATALOG_QUERY_PORT`/`TRANSACTION_MANAGER`/`EVENT_PUBLISHER`/
// `NOTIFICATION_PORT` overridden — no local Supabase/Docker required, same
// e2e convention every spec in this repo already follows.
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

function providerCatalogItemFixture(
  overrides: Partial<ProviderCatalogItem> = {},
): ProviderCatalogItem {
  return {
    id: randomUUID(),
    companyId: randomUUID(),
    catalogProductId: randomUUID(),
    nombre: 'Alimento perro',
    categoria: 'alimento',
    precioBase: 10990,
    precioMaximo: 12990,
    stock: 10,
    disponible: true,
    ...overrides,
  };
}

function validBody(userId: string, providerCatalogItemId: string) {
  return {
    userId,
    items: [{ providerCatalogItemId, precio: 11990, isAlt: false }],
    entrega: { tiempoEntregaHoras: 24, costoDespacho: 2000 },
  };
}

describe('Ofertas — POST /ofertas/proactivas (e2e)', () => {
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
    catalogQueryPort = {
      buscarCoincidencias: jest.fn(),
      obtenerItemsDeProveedor: jest.fn().mockResolvedValue([]),
    };
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
    const providerCatalogItemId = randomUUID();
    actorPort.findActorById.mockResolvedValueOnce(buildProviderActor({ profileId, companyId }));
    opportunityRepository.existeRelacion.mockResolvedValueOnce(true);
    catalogQueryPort.obtenerItemsDeProveedor.mockResolvedValueOnce([
      providerCatalogItemFixture({ id: providerCatalogItemId }),
    ]);
    const token = await signToken(profileId);

    const res = await request(app.getHttpServer())
      .post('/ofertas/proactivas')
      .set('Authorization', `Bearer ${token}`)
      .send(validBody(userId, providerCatalogItemId))
      .expect(201);

    expect(res.body).toMatchObject({
      userId,
      companyId,
      status: 'pendiente',
      kind: 'proactiva',
      total: 11990 + 2000,
    });
    expect(res.body.refillRequestId).toBeUndefined();
    expect(res.body.items).toHaveLength(1);
    expect(res.body.items[0]).toMatchObject({ providerCatalogItemId, precio: 11990, isAlt: false });

    // `runInTransaction` wraps exactly one `save()` call (design.md D13
    // paso 10), same assertion convention as `ofertas-enviar-oferta.e2e-spec.ts`.
    expect(offerRepository.save).toHaveBeenCalledTimes(1);
    expect(offerRepository.save).toHaveBeenCalledWith(
      expect.objectContaining({ userId, companyId, kind: 'proactiva' }),
      expect.anything(),
    );
    // refillRequestId viaja null en el evento (design.md línea 662, diferencia (c)).
    expect(eventPublisher.publish).toHaveBeenCalledTimes(1);
    const [publishedEvent] = eventPublisher.publish.mock.calls[0] as [OfertaEnviada];
    expect(publishedEvent.payload).toMatchObject({ refillRequestId: null });
    expect(notificationPort.sendPush).toHaveBeenCalledWith(userId, expect.any(String));
  });

  it('returns 404 DESTINATARIO_NO_ELEGIBLE when the userId has no qualifying relationship (D10), and persists nothing', async () => {
    const profileId = randomUUID();
    const companyId = randomUUID();
    const userId = randomUUID();
    const providerCatalogItemId = randomUUID();
    actorPort.findActorById.mockResolvedValueOnce(buildProviderActor({ profileId, companyId }));
    opportunityRepository.existeRelacion.mockResolvedValueOnce(false);
    const token = await signToken(profileId);

    const res = await request(app.getHttpServer())
      .post('/ofertas/proactivas')
      .set('Authorization', `Bearer ${token}`)
      .send(validBody(userId, providerCatalogItemId))
      .expect(404);

    expect(res.body).toMatchObject({ statusCode: 404, code: 'DESTINATARIO_NO_ELEGIBLE' });
    expect(catalogQueryPort.obtenerItemsDeProveedor).not.toHaveBeenCalled();
    expect(offerRepository.save).not.toHaveBeenCalled();
  });

  it(
    'returns 400 OFERTA_ITEMS_NO_DISPONIBLES for a competitor/foreign providerCatalogItemId ' +
      '(D-B cardinality mismatch), and persists nothing',
    async () => {
      const profileId = randomUUID();
      const companyId = randomUUID();
      const userId = randomUUID();
      const providerCatalogItemId = randomUUID();
      actorPort.findActorById.mockResolvedValueOnce(buildProviderActor({ profileId, companyId }));
      opportunityRepository.existeRelacion.mockResolvedValueOnce(true);
      // El puerto descarta en silencio el id ajeno (C9) -- vuelve [] en vez
      // de 1, la cardinalidad no coincide.
      catalogQueryPort.obtenerItemsDeProveedor.mockResolvedValueOnce([]);
      const token = await signToken(profileId);

      const res = await request(app.getHttpServer())
        .post('/ofertas/proactivas')
        .set('Authorization', `Bearer ${token}`)
        .send(validBody(userId, providerCatalogItemId))
        .expect(400);

      expect(res.body).toMatchObject({ statusCode: 400, code: 'OFERTA_ITEMS_NO_DISPONIBLES' });
      expect(offerRepository.save).not.toHaveBeenCalled();
    },
  );

  it(
    'returns 503 CATALOG_UNAVAILABLE when the catalog port rejects, and the offer is NEVER ' +
      'persisted (C8, inherited by D-B)',
    async () => {
      const profileId = randomUUID();
      const companyId = randomUUID();
      const userId = randomUUID();
      const providerCatalogItemId = randomUUID();
      actorPort.findActorById.mockResolvedValueOnce(buildProviderActor({ profileId, companyId }));
      opportunityRepository.existeRelacion.mockResolvedValueOnce(true);
      catalogQueryPort.obtenerItemsDeProveedor.mockRejectedValueOnce(
        new CatalogQueryUnavailableError(),
      );
      const token = await signToken(profileId);

      const res = await request(app.getHttpServer())
        .post('/ofertas/proactivas')
        .set('Authorization', `Bearer ${token}`)
        .send(validBody(userId, providerCatalogItemId))
        .expect(503);

      expect(res.body).toMatchObject({ statusCode: 503, code: 'CATALOG_UNAVAILABLE' });
      expect(transactionManager.runInTransaction).not.toHaveBeenCalled();
      expect(offerRepository.save).not.toHaveBeenCalled();
      expect(eventPublisher.publish).not.toHaveBeenCalled();
    },
  );

  it('rejects an unauthenticated request with 401', () => {
    return request(app.getHttpServer())
      .post('/ofertas/proactivas')
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
      .post('/ofertas/proactivas')
      .set('Authorization', `Bearer ${token}`)
      .send(validBody(randomUUID(), randomUUID()))
      .expect(403);

    expect(res.body).toMatchObject({ statusCode: 403, code: 'ROLE_NOT_ALLOWED' });
    expect(opportunityRepository.existeRelacion).not.toHaveBeenCalled();
    expect(offerRepository.save).not.toHaveBeenCalled();
  });
});
