import { randomUUID } from 'node:crypto';
import { INestApplication, ValidationPipe } from '@nestjs/common';
import { EventEmitter2 } from '@nestjs/event-emitter';
import { Test } from '@nestjs/testing';
import type { RefillRequestActiva, RefillRequestBorrador } from '@repon/types';
import { SignJWT } from 'jose';
import request from 'supertest';
import { AppModule } from '../src/app.module';
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

// core-api-refill-matching spec: "completarBorrador enforces direccion +
// comuna + every item's categoria + precioReferencia before transitioning to
// 'abierta'" (D3/D4) + "completarBorrador publishes RefillCreado after
// commit" (D-C Decisión 1) — end to end. Mirrors
// `refill-crear-solicitud.e2e-spec.ts`'s (PR4b) and
// `refill-buscar-proveedores.e2e-spec.ts`'s (PR5b) override shape: REAL
// `AuthGuard`/`ValidationPipe`/`RefillExceptionFilter` AND the REAL event
// bus (`EVENT_PUBLISHER` stays bound to the real
// `EventEmitterPublisher`/`EventEmitter2` — this suite's happy-path
// scenario proves `RefillCreado` is genuinely observable on the real bus
// after commit, same property PR4b's own e2e proves for `crearSolicitud`).
// `ACTOR_PORT`/`REFILL_REPOSITORY` are the only 2 overrides — same as PR4b.
//
// There is no HTTP route that creates a `'borrador'` request (Phase 6a's
// listener is the only creator, and it only reacts to a real `consumo`
// event). Since `REFILL_REPOSITORY` is entirely mocked here — same as
// PR4b/PR5b, no real Supabase writes happen in this suite — the borrador
// fixture is built directly via `buildBorrador()` below and handed back by
// the mocked `findById()`, reusing PR5b's exact precedent for "inserting a
// borrador row for test setup" rather than round-tripping through the real
// `consumo.refill_auto_solicitado` event bus (PR6a's own e2e uses the
// latter, but that suite is testing the LISTENER itself, not an HTTP route
// — this suite has no listener to exercise, only the controller/use-case/
// filter chain PR4b/PR5b's e2e pattern already fits directly).
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

function buildCompletarBody(itemId: string) {
  return {
    direccion: 'Av. Siempre Viva 742',
    comuna: 'Providencia',
    items: [{ refillItemId: itemId, categoria: 'Medicamentos', precioReferencia: 5990 }],
  };
}

describe('Refill — POST /refill/mis-solicitudes/:refillRequestId/completar (e2e)', () => {
  let app: INestApplication;
  let actorPort: jest.Mocked<ActorPort>;
  let refillRepository: jest.Mocked<RefillRepository>;
  let eventEmitter: EventEmitter2;

  beforeAll(async () => {
    actorPort = { findActorById: jest.fn() };
    refillRepository = {
      save: jest.fn().mockResolvedValue(undefined),
      findById: jest.fn(),
      findBorradorByConsumption: jest.fn(),
      actualizarEstado: jest.fn(),
    };

    const moduleRef = await Test.createTestingModule({ imports: [AppModule] })
      .overrideProvider(ACTOR_PORT)
      .useValue(actorPort)
      .overrideProvider(REFILL_REPOSITORY)
      .useValue(refillRepository)
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

  it("200s, transitions the borrador to 'abierta', and RefillCreado is observable on the real event bus after commit", async () => {
    const profileId = randomUUID();
    const refillRequestId = randomUUID();
    const itemId = randomUUID();
    actorPort.findActorById.mockResolvedValueOnce(buildUserActor({ profileId }));
    const token = await signToken(profileId);
    refillRepository.findById.mockResolvedValueOnce(
      buildBorrador({
        id: refillRequestId,
        userId: profileId,
        items: [{ id: itemId, nombre: 'Losartan 50mg' }],
      }),
    );

    // Registered BEFORE the request, per this repo's
    // `catalogo-visibility.e2e-spec.ts`/`refill-crear-solicitud.e2e-spec.ts`
    // precedent for asserting a real event fired.
    const refillCreadoSpy = jest.fn();
    eventEmitter.on('refill.creado', refillCreadoSpy);

    const res = await request(app.getHttpServer())
      .post(`/refill/mis-solicitudes/${refillRequestId}/completar`)
      .set('Authorization', `Bearer ${token}`)
      .send(buildCompletarBody(itemId))
      .expect(200);

    eventEmitter.off('refill.creado', refillCreadoSpy);

    expect(res.body).toMatchObject({
      id: refillRequestId,
      userId: profileId,
      direccion: 'Av. Siempre Viva 742',
      comuna: 'Providencia',
      estado: 'abierta',
    });
    expect(res.body.items).toEqual([
      expect.objectContaining({
        id: itemId,
        nombre: 'Losartan 50mg',
        categoria: 'Medicamentos',
        precioReferencia: 5990,
      }),
    ]);

    // `CompletarBorradorUseCase.execute()` calls `save()` exactly once,
    // inside `runInTransaction`, on the SAME `tx` `findById` used (design.md
    // Diagrama 1's closing note; tasks.md 6b.2: "same pattern as
    // marcarDosisTomada").
    expect(refillRepository.save).toHaveBeenCalledTimes(1);
    expect(refillRepository.save).toHaveBeenCalledWith(
      expect.objectContaining({ id: refillRequestId, userId: profileId, estado: 'abierta' }),
      expect.anything(),
    );

    // By the time supertest's `.expect(200)` resolves, `execute()` has
    // already awaited `eventPublisher.publish()` (publish happens after
    // `runInTransaction` resolves, before `execute()` returns — same
    // ordering PR4a's `CrearSolicitudUseCase` established) — so the spy
    // registered above is observable right here, on the REAL bus.
    expect(refillCreadoSpy).toHaveBeenCalledTimes(1);
    expect(refillCreadoSpy).toHaveBeenCalledWith(
      expect.objectContaining({
        type: 'refill.creado',
        payload: expect.objectContaining({
          refillRequestId,
          userId: profileId,
          comuna: 'Providencia',
        }),
      }),
    );
    // D-C privacy rule: direccion never travels on the event payload.
    const publishedEvent = refillCreadoSpy.mock.calls[0][0] as { payload: object };
    expect(publishedEvent.payload).not.toHaveProperty('direccion');
  });

  // The next 3 tests fail DTO validation at `ValidationPipe`, BEFORE the
  // controller method (and therefore `findById`) ever runs — deliberately
  // NOT stubbing `refillRepository.findById` here: `mockResolvedValueOnce`
  // queues are FIFO and NOT drained by `afterEach`'s `jest.clearAllMocks()`
  // (`clearAllMocks` resets call history, not queued once-implementations),
  // so an unconsumed stub here would silently leak into a LATER test that
  // does reach `findById` — the exact bug this comment exists to prevent
  // re-introducing.
  it('returns 400 for a missing direccion, and saves nothing', async () => {
    const profileId = randomUUID();
    const refillRequestId = randomUUID();
    const itemId = randomUUID();
    actorPort.findActorById.mockResolvedValueOnce(buildUserActor({ profileId }));
    const token = await signToken(profileId);
    const { direccion: _direccion, ...withoutDireccion } = buildCompletarBody(itemId);

    const res = await request(app.getHttpServer())
      .post(`/refill/mis-solicitudes/${refillRequestId}/completar`)
      .set('Authorization', `Bearer ${token}`)
      .send(withoutDireccion)
      .expect(400);

    expect(res.body).toMatchObject({ statusCode: 400 });
    expect(refillRepository.findById).not.toHaveBeenCalled();
    expect(refillRepository.save).not.toHaveBeenCalled();
  });

  it('returns 400 for a missing comuna, and saves nothing', async () => {
    const profileId = randomUUID();
    const refillRequestId = randomUUID();
    const itemId = randomUUID();
    actorPort.findActorById.mockResolvedValueOnce(buildUserActor({ profileId }));
    const token = await signToken(profileId);
    const { comuna: _comuna, ...withoutComuna } = buildCompletarBody(itemId);

    const res = await request(app.getHttpServer())
      .post(`/refill/mis-solicitudes/${refillRequestId}/completar`)
      .set('Authorization', `Bearer ${token}`)
      .send(withoutComuna)
      .expect(400);

    expect(res.body).toMatchObject({ statusCode: 400 });
    expect(refillRepository.findById).not.toHaveBeenCalled();
    expect(refillRepository.save).not.toHaveBeenCalled();
  });

  it('returns 400 for an item missing categoria/precioReferencia (nested DTO validation), and saves nothing', async () => {
    const profileId = randomUUID();
    const refillRequestId = randomUUID();
    const itemId = randomUUID();
    actorPort.findActorById.mockResolvedValueOnce(buildUserActor({ profileId }));
    const token = await signToken(profileId);

    const res = await request(app.getHttpServer())
      .post(`/refill/mis-solicitudes/${refillRequestId}/completar`)
      .set('Authorization', `Bearer ${token}`)
      .send({
        direccion: 'Av. Siempre Viva 742',
        comuna: 'Providencia',
        items: [{ refillItemId: itemId }],
      })
      .expect(400);

    expect(res.body).toMatchObject({ statusCode: 400 });
    expect(refillRepository.findById).not.toHaveBeenCalled();
    expect(refillRepository.save).not.toHaveBeenCalled();
  });

  it('returns 400 REFILL_ITEM_DESCONOCIDO for a refillItemId that does not belong to the borrador, and saves nothing', async () => {
    const profileId = randomUUID();
    const refillRequestId = randomUUID();
    const itemId = randomUUID();
    actorPort.findActorById.mockResolvedValueOnce(buildUserActor({ profileId }));
    const token = await signToken(profileId);
    refillRepository.findById.mockResolvedValueOnce(
      buildBorrador({
        id: refillRequestId,
        userId: profileId,
        items: [{ id: itemId, nombre: 'x' }],
      }),
    );

    const res = await request(app.getHttpServer())
      .post(`/refill/mis-solicitudes/${refillRequestId}/completar`)
      .set('Authorization', `Bearer ${token}`)
      .send(buildCompletarBody(randomUUID()))
      .expect(400);

    expect(res.body).toMatchObject({ statusCode: 400, code: 'REFILL_ITEM_DESCONOCIDO' });
    expect(refillRepository.save).not.toHaveBeenCalled();
  });

  it('returns 404 for a borrador belonging to another user (cross-tenant), and saves nothing', async () => {
    const ownerId = randomUUID();
    const callerId = randomUUID();
    const refillRequestId = randomUUID();
    const itemId = randomUUID();
    actorPort.findActorById.mockResolvedValueOnce(buildUserActor({ profileId: callerId }));
    const token = await signToken(callerId);
    refillRepository.findById.mockResolvedValueOnce(
      buildBorrador({ id: refillRequestId, userId: ownerId, items: [{ id: itemId, nombre: 'x' }] }),
    );

    const res = await request(app.getHttpServer())
      .post(`/refill/mis-solicitudes/${refillRequestId}/completar`)
      .set('Authorization', `Bearer ${token}`)
      .send(buildCompletarBody(itemId))
      .expect(404);

    expect(res.body).toMatchObject({ statusCode: 404, code: 'REFILL_REQUEST_NOT_FOUND' });
    expect(refillRepository.save).not.toHaveBeenCalled();
  });

  it('returns 409 TRANSICION_INVALIDA when completing an already-abierta request (created via POST /refill/mis-solicitudes)', async () => {
    const profileId = randomUUID();
    actorPort.findActorById.mockResolvedValue(buildUserActor({ profileId }));
    const token = await signToken(profileId);

    const createRes = await request(app.getHttpServer())
      .post('/refill/mis-solicitudes')
      .set('Authorization', `Bearer ${token}`)
      .send({
        items: [{ nombre: 'Losartan 50mg', categoria: 'Medicamentos', precioReferencia: 5990 }],
        direccion: 'Av. Siempre Viva 742',
        comuna: 'Providencia',
        urgencia: 'hoy',
      })
      .expect(201);

    // `REFILL_REPOSITORY` is entirely mocked (`save` above resolved without
    // actually persisting anything) — `findById` needs its own explicit
    // mock to hand the just-"created" abierta entity back for the completar
    // attempt below.
    refillRepository.findById.mockResolvedValueOnce(createRes.body as RefillRequestActiva);

    const res = await request(app.getHttpServer())
      .post(`/refill/mis-solicitudes/${createRes.body.id}/completar`)
      .set('Authorization', `Bearer ${token}`)
      .send(buildCompletarBody(createRes.body.items[0].id))
      .expect(409);

    expect(res.body).toMatchObject({ statusCode: 409, code: 'TRANSICION_INVALIDA' });
  });

  it('rejects an unauthenticated request with 401', () => {
    return request(app.getHttpServer())
      .post(`/refill/mis-solicitudes/${randomUUID()}/completar`)
      .send(buildCompletarBody(randomUUID()))
      .expect(401)
      .expect((res) => {
        expect(res.body).toMatchObject({ statusCode: 401, code: 'MISSING_BEARER_TOKEN' });
      });
  });
});
