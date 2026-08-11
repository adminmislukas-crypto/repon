import { randomUUID } from 'node:crypto';
import { INestApplication, ValidationPipe } from '@nestjs/common';
import { EventEmitter2 } from '@nestjs/event-emitter';
import { Test } from '@nestjs/testing';
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

// core-api-refill-matching spec: "crearSolicitud persists the request and
// its items in one transaction; RefillCreado publishes only after commit",
// "The actor's profileId becomes the owner", "No DTO in this domain
// accepts a client-supplied userId", "HTTP-originated request starts in
// abierta" — end to end, mirroring `consumo-mis-consumos.e2e-spec.ts`'s
// override shape: REAL `AuthGuard`/`ValidationPipe`/`RefillExceptionFilter`
// AND the REAL event bus (`EVENT_PUBLISHER` is left bound to the real
// `EventEmitterPublisher`/`EventEmitter2` — not mocked, unlike
// `consumo-marcar-dosis.e2e-spec.ts` — because this test's whole point is
// proving `RefillCreado` is genuinely observable on the real bus, the same
// property `catalogo-visibility.e2e-spec.ts` proves for its own listener).
// Only `ACTOR_PORT`/`REFILL_REPOSITORY` are overridden — no local Supabase
// required.
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

const validBody = {
  items: [
    { nombre: 'Losartan 50mg', categoria: 'Medicamentos', precioReferencia: 5990 },
    { nombre: 'Alimento Perro 15kg', categoria: 'Alimentos', precioReferencia: 25990 },
  ],
  direccion: 'Av. Siempre Viva 742',
  comuna: 'Providencia',
  urgencia: 'hoy',
};

describe('Refill — POST /refill/mis-solicitudes (e2e)', () => {
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

  it('201s, persists the request + N items in one save() call, and RefillCreado is observable on the real event bus', async () => {
    const profileId = randomUUID();
    actorPort.findActorById.mockResolvedValueOnce(buildUserActor({ profileId }));
    const token = await signToken(profileId);

    // Registered BEFORE the request, per this repo's `catalogo-visibility.e2e-spec.ts`
    // precedent for asserting a real event fired.
    const refillCreadoSpy = jest.fn();
    eventEmitter.on('refill.creado', refillCreadoSpy);

    const res = await request(app.getHttpServer())
      .post('/refill/mis-solicitudes')
      .set('Authorization', `Bearer ${token}`)
      .send(validBody)
      .expect(201);

    eventEmitter.off('refill.creado', refillCreadoSpy);

    expect(res.body).toMatchObject({
      userId: profileId,
      direccion: validBody.direccion,
      comuna: validBody.comuna,
      urgencia: validBody.urgencia,
      estado: 'abierta',
    });
    expect(res.body.items).toHaveLength(2);

    // `CrearSolicitudUseCase.execute()` calls `save()` exactly once, inside
    // `runInTransaction`, with the request AND its N items on one entity
    // (design.md D14) — asserted here at the repository-mock boundary, same
    // convention `consumo-mis-consumos.e2e-spec.ts` uses.
    expect(refillRepository.save).toHaveBeenCalledTimes(1);
    expect(refillRepository.save).toHaveBeenCalledWith(
      expect.objectContaining({
        userId: profileId,
        estado: 'abierta',
        direccion: validBody.direccion,
        comuna: validBody.comuna,
        items: expect.arrayContaining([
          expect.objectContaining({ nombre: 'Losartan 50mg' }),
          expect.objectContaining({ nombre: 'Alimento Perro 15kg' }),
        ]),
      }),
      expect.anything(),
    );

    // By the time supertest's `.expect(201)` resolves, `execute()` has
    // already awaited `eventPublisher.publish()` (PR4a: publish happens
    // after `runInTransaction` resolves, before `execute()` returns) — so
    // the spy registered above is observable right here, on the REAL bus,
    // never via a mocked `EVENT_PUBLISHER`.
    expect(refillCreadoSpy).toHaveBeenCalledTimes(1);
    expect(refillCreadoSpy).toHaveBeenCalledWith(
      expect.objectContaining({
        type: 'refill.creado',
        payload: expect.objectContaining({
          refillRequestId: res.body.id,
          userId: profileId,
          comuna: validBody.comuna,
          urgencia: validBody.urgencia,
        }),
      }),
    );
    // D-C privacy rule: direccion never travels on the event payload.
    const publishedEvent = refillCreadoSpy.mock.calls[0][0] as { payload: object };
    expect(publishedEvent.payload).not.toHaveProperty('direccion');
  });

  it('returns 400 for an empty items array, and saves nothing', async () => {
    const profileId = randomUUID();
    actorPort.findActorById.mockResolvedValueOnce(buildUserActor({ profileId }));
    const token = await signToken(profileId);

    const res = await request(app.getHttpServer())
      .post('/refill/mis-solicitudes')
      .set('Authorization', `Bearer ${token}`)
      .send({ ...validBody, items: [] })
      .expect(400);

    expect(res.body).toMatchObject({ statusCode: 400 });
    expect(refillRepository.save).not.toHaveBeenCalled();
  });

  it('returns 400 for a negative precioReferencia, and saves nothing', async () => {
    const profileId = randomUUID();
    actorPort.findActorById.mockResolvedValueOnce(buildUserActor({ profileId }));
    const token = await signToken(profileId);

    const res = await request(app.getHttpServer())
      .post('/refill/mis-solicitudes')
      .set('Authorization', `Bearer ${token}`)
      .send({
        ...validBody,
        items: [{ nombre: 'Losartan 50mg', categoria: 'Medicamentos', precioReferencia: -1 }],
      })
      .expect(400);

    expect(res.body).toMatchObject({ statusCode: 400 });
    expect(refillRepository.save).not.toHaveBeenCalled();
  });

  it('returns 400 for a missing comuna, and saves nothing', async () => {
    const profileId = randomUUID();
    actorPort.findActorById.mockResolvedValueOnce(buildUserActor({ profileId }));
    const token = await signToken(profileId);
    const { comuna: _comuna, ...withoutComuna } = validBody;

    const res = await request(app.getHttpServer())
      .post('/refill/mis-solicitudes')
      .set('Authorization', `Bearer ${token}`)
      .send(withoutComuna)
      .expect(400);

    expect(res.body).toMatchObject({ statusCode: 400 });
    expect(refillRepository.save).not.toHaveBeenCalled();
  });

  it('rejects an unauthenticated request with 401', () => {
    return request(app.getHttpServer())
      .post('/refill/mis-solicitudes')
      .send(validBody)
      .expect(401)
      .expect((res) => {
        expect(res.body).toMatchObject({ statusCode: 401, code: 'MISSING_BEARER_TOKEN' });
      });
  });

  it('rejects a client-supplied userId with 400 — the DTO has no such field, whitelist strips-then-forbids it (D13)', async () => {
    const profileId = randomUUID();
    actorPort.findActorById.mockResolvedValueOnce(buildUserActor({ profileId }));
    const token = await signToken(profileId);

    const res = await request(app.getHttpServer())
      .post('/refill/mis-solicitudes')
      .set('Authorization', `Bearer ${token}`)
      .send({ ...validBody, userId: randomUUID() })
      .expect(400);

    expect(res.body).toMatchObject({ statusCode: 400 });
    expect(refillRepository.save).not.toHaveBeenCalled();
  });
});
