import { randomUUID } from 'node:crypto';
import { INestApplication, ValidationPipe } from '@nestjs/common';
import { EventEmitter2 } from '@nestjs/event-emitter';
import { Test } from '@nestjs/testing';
import type { ProviderCatalogItem, RefillRequestActiva, RefillRequestBorrador } from '@repon/types';
import { SignJWT } from 'jose';
import request from 'supertest';
import { AppModule } from '../src/app.module';
import {
  CATALOG_QUERY_PORT,
  CatalogQueryUnavailableError,
  type CatalogQueryPort,
} from '../src/domains/catalogo/contracts/catalog-query.port';
import {
  REFILL_REPOSITORY,
  type RefillRepository,
} from '../src/domains/refill-matching/ports-out/refill-repository.port';
import { GlobalExceptionFilter } from '../src/shared/auth/global-exception.filter';
import {
  ACTOR_PORT,
  type ActorPort,
  type AuthenticatedActor,
} from '../src/shared/auth/ports/actor.port';

// core-api-refill-matching spec: "buscarProveedoresCompatibles is
// owner-scoped; cross-tenant access is 404, never 403",
// "buscarProveedoresCompatibles on a 'borrador' request fails explicitly,
// never []", "A catalog outage maps to 503, not an empty result",
// "MatchEncontrado publishes even when zero providers match" — end to end.
// Mirrors `refill-crear-solicitud.e2e-spec.ts`'s (PR4b) override shape:
// REAL `AuthGuard`/`ValidationPipe`/`RefillExceptionFilter` AND the REAL
// event bus (`EVENT_PUBLISHER` stays bound to the real
// `EventEmitterPublisher`/`EventEmitter2` — this test's whole point for its
// last scenario is proving `MatchEncontrado` is genuinely observable on the
// real bus even on a zero-match search). `ACTOR_PORT`/`REFILL_REPOSITORY`/
// `CATALOG_QUERY_PORT` are the only 3 overrides — no local Supabase
// required, same as PR4b.
//
// The 409-on-own-borrador scenario needs a `'borrador'` fixture, and there
// is no HTTP route that creates one yet (Phase 6a adds the
// `RefillAutoSolicitado` listener later). Since `REFILL_REPOSITORY` is
// entirely mocked here (same as PR4b — no real Supabase writes happen in
// this suite), the borrador fixture is built directly via `buildBorrador()`
// below and handed back by the mocked `findById()`, which is this suite's
// direct equivalent of "inserting a borrador row for test setup".
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

function buildUserActor(
  overrides: Partial<AuthenticatedActor> & { profileId: string },
): AuthenticatedActor {
  return {
    role: 'user',
    status: 'activo',
    companyId: null,
    companyStatus: null,
    adminRole: null,
    ...overrides,
  };
}

function buildActiva(
  overrides: Partial<RefillRequestActiva> & { userId: string },
): RefillRequestActiva {
  return {
    id: randomUUID(),
    urgencia: 'hoy',
    direccion: 'Av. Siempre Viva 742',
    comuna: 'Providencia',
    estado: 'abierta',
    items: [
      {
        id: randomUUID(),
        nombre: 'Losartan 50mg',
        categoria: 'Medicamentos',
        precioReferencia: 5990,
      },
    ],
    ...overrides,
  };
}

function buildBorrador(
  overrides: Partial<RefillRequestBorrador> & { userId: string },
): RefillRequestBorrador {
  return {
    id: randomUUID(),
    urgencia: 'lo_antes_posible',
    estado: 'borrador',
    items: [{ id: randomUUID(), nombre: 'Losartan 50mg' }],
    ...overrides,
  };
}

function buildProviderCatalogItem(
  overrides: Partial<ProviderCatalogItem> = {},
): ProviderCatalogItem {
  return {
    id: randomUUID(),
    companyId: randomUUID(),
    nombre: 'Losartan 50mg',
    categoria: 'Medicamentos',
    precioBase: 5990,
    precioMaximo: 7990,
    stock: 10,
    disponible: true,
    ...overrides,
  };
}

describe('Refill — POST /refill/mis-solicitudes/:refillRequestId/matching (e2e)', () => {
  let app: INestApplication;
  let actorPort: jest.Mocked<ActorPort>;
  let refillRepository: jest.Mocked<RefillRepository>;
  let catalogQueryPort: jest.Mocked<CatalogQueryPort>;
  let eventEmitter: EventEmitter2;

  beforeAll(async () => {
    actorPort = { findActorById: jest.fn() };
    refillRepository = {
      save: jest.fn().mockResolvedValue(undefined),
      findById: jest.fn(),
      findBorradorByConsumption: jest.fn(),
      actualizarEstado: jest.fn(),
    };
    catalogQueryPort = {
      buscarCoincidencias: jest.fn(),
      // PR6a additive delta (D-B) — unused by this route, present only to
      // satisfy the interface's strict `jest.Mocked<CatalogQueryPort>` shape.
      obtenerItemsDeProveedor: jest.fn(),
    };

    const moduleRef = await Test.createTestingModule({ imports: [AppModule] })
      .overrideProvider(ACTOR_PORT)
      .useValue(actorPort)
      .overrideProvider(REFILL_REPOSITORY)
      .useValue(refillRepository)
      .overrideProvider(CATALOG_QUERY_PORT)
      .useValue(catalogQueryPort)
      .compile();

    app = moduleRef.createNestApplication();
    // Mirrors main.ts's real bootstrap wiring.
    app.useGlobalPipes(
      new ValidationPipe({ whitelist: true, forbidNonWhitelisted: true, transform: true }),
    );
    app.useGlobalFilters(new GlobalExceptionFilter());
    await app.init();

    // `strict: false` (explicit, not relying on the default): `EventEmitter2`
    // is provided deep inside `EventBusModule`'s `EventEmitterModule.forRoot()`,
    // not re-exported by name — this searches the whole container instead of
    // only `AppModule`'s own provider list.
    eventEmitter = app.get(EventEmitter2, { strict: false });
  });

  afterEach(() => jest.clearAllMocks());

  afterAll(async () => {
    await app.close();
  });

  it('returns 404 for a request belonging to another user (cross-tenant), and never queries the catalog', async () => {
    const ownerId = randomUUID();
    const callerId = randomUUID();
    const refillRequestId = randomUUID();
    actorPort.findActorById.mockResolvedValueOnce(buildUserActor({ profileId: callerId }));
    const token = await signToken(callerId);
    refillRepository.findById.mockResolvedValueOnce(
      buildActiva({ id: refillRequestId, userId: ownerId }),
    );

    const res = await request(app.getHttpServer())
      .post(`/refill/mis-solicitudes/${refillRequestId}/matching`)
      .set('Authorization', `Bearer ${token}`)
      .expect(404);

    expect(res.body).toMatchObject({ statusCode: 404, code: 'REFILL_REQUEST_NOT_FOUND' });
    expect(catalogQueryPort.buscarCoincidencias).not.toHaveBeenCalled();
  });

  it('returns 404 (never 409) for a borrador belonging to another user — ownership is checked before state', async () => {
    const ownerId = randomUUID();
    const callerId = randomUUID();
    const refillRequestId = randomUUID();
    actorPort.findActorById.mockResolvedValueOnce(buildUserActor({ profileId: callerId }));
    const token = await signToken(callerId);
    refillRepository.findById.mockResolvedValueOnce(
      buildBorrador({ id: refillRequestId, userId: ownerId }),
    );

    const res = await request(app.getHttpServer())
      .post(`/refill/mis-solicitudes/${refillRequestId}/matching`)
      .set('Authorization', `Bearer ${token}`)
      .expect(404);

    expect(res.body).toMatchObject({ statusCode: 404, code: 'REFILL_REQUEST_NOT_FOUND' });
  });

  it("returns 409 for the caller's OWN borrador, never [] with 200", async () => {
    const profileId = randomUUID();
    const refillRequestId = randomUUID();
    actorPort.findActorById.mockResolvedValueOnce(buildUserActor({ profileId }));
    const token = await signToken(profileId);
    refillRepository.findById.mockResolvedValueOnce(
      buildBorrador({ id: refillRequestId, userId: profileId }),
    );

    const res = await request(app.getHttpServer())
      .post(`/refill/mis-solicitudes/${refillRequestId}/matching`)
      .set('Authorization', `Bearer ${token}`)
      .expect(409);

    expect(res.body).toMatchObject({ statusCode: 409, code: 'REFILL_REQUEST_EN_BORRADOR' });
    expect(catalogQueryPort.buscarCoincidencias).not.toHaveBeenCalled();
  });

  it('returns 503 (never a degraded 200) when the catalog query port throws CatalogQueryUnavailableError', async () => {
    const profileId = randomUUID();
    const refillRequestId = randomUUID();
    actorPort.findActorById.mockResolvedValueOnce(buildUserActor({ profileId }));
    const token = await signToken(profileId);
    refillRepository.findById.mockResolvedValueOnce(
      buildActiva({ id: refillRequestId, userId: profileId }),
    );
    catalogQueryPort.buscarCoincidencias.mockRejectedValueOnce(new CatalogQueryUnavailableError());

    const res = await request(app.getHttpServer())
      .post(`/refill/mis-solicitudes/${refillRequestId}/matching`)
      .set('Authorization', `Bearer ${token}`)
      .expect(503);

    expect(res.body).toMatchObject({ statusCode: 503, code: 'CATALOG_UNAVAILABLE' });
  });

  it('200s with the compatible providers when matches exist', async () => {
    const profileId = randomUUID();
    const refillRequestId = randomUUID();
    actorPort.findActorById.mockResolvedValueOnce(buildUserActor({ profileId }));
    const token = await signToken(profileId);
    refillRepository.findById.mockResolvedValueOnce(
      buildActiva({ id: refillRequestId, userId: profileId }),
    );
    const match = buildProviderCatalogItem();
    catalogQueryPort.buscarCoincidencias.mockResolvedValueOnce([match]);

    const res = await request(app.getHttpServer())
      .post(`/refill/mis-solicitudes/${refillRequestId}/matching`)
      .set('Authorization', `Bearer ${token}`)
      .expect(200);

    expect(res.body).toEqual([
      expect.objectContaining({
        id: match.id,
        companyId: match.companyId,
        nombre: match.nombre,
        categoria: match.categoria,
        precioBase: match.precioBase,
        precioMaximo: match.precioMaximo,
        stock: match.stock,
        disponible: match.disponible,
      }),
    ]);
  });

  it('200s with an empty list on a zero-match search, and MatchEncontrado still fires with companyIds: [] on the real event bus', async () => {
    const profileId = randomUUID();
    const refillRequestId = randomUUID();
    actorPort.findActorById.mockResolvedValueOnce(buildUserActor({ profileId }));
    const token = await signToken(profileId);
    refillRepository.findById.mockResolvedValueOnce(
      buildActiva({ id: refillRequestId, userId: profileId }),
    );
    catalogQueryPort.buscarCoincidencias.mockResolvedValueOnce([]);

    // Registered BEFORE the request, per this repo's
    // `catalogo-visibility.e2e-spec.ts`/`refill-crear-solicitud.e2e-spec.ts`
    // precedent for asserting a real event fired.
    const matchEncontradoSpy = jest.fn();
    eventEmitter.on('refill.match_encontrado', matchEncontradoSpy);

    const res = await request(app.getHttpServer())
      .post(`/refill/mis-solicitudes/${refillRequestId}/matching`)
      .set('Authorization', `Bearer ${token}`)
      .expect(200);

    eventEmitter.off('refill.match_encontrado', matchEncontradoSpy);

    // The event is the source of truth for "the search never suppresses on
    // zero matches" (D-C) — asserted on the bus, not just the HTTP shape.
    expect(res.body).toEqual([]);
    expect(matchEncontradoSpy).toHaveBeenCalledTimes(1);
    expect(matchEncontradoSpy).toHaveBeenCalledWith(
      expect.objectContaining({
        type: 'refill.match_encontrado',
        payload: expect.objectContaining({
          refillRequestId,
          companyIds: [],
          providerCatalogItemIds: [],
        }),
      }),
    );
  });
});
