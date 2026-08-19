import { randomUUID } from 'node:crypto';
import { INestApplication, ValidationPipe } from '@nestjs/common';
import { Test } from '@nestjs/testing';
import type { UserConsumption } from '@repon/types';
import { SignJWT } from 'jose';
import request from 'supertest';
import { AppModule } from '../src/app.module';
import {
  CONSUMPTION_LOG_REPOSITORY,
  type ConsumptionLogRepository,
} from '../src/domains/consumo/ports-out/consumption-log-repository.port';
import {
  CONSUMPTION_REPOSITORY,
  type ConsumptionRepository,
} from '../src/domains/consumo/ports-out/consumption-repository.port';
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

// core-api-consumo spec: "marcarDosisTomada is scoped to the caller's own
// consumption; cross-tenant access is a 404, never 403, and does not
// mutate" + "writes the log and decrements stock in one transaction;
// DosisRegistrada publishes only after commit" (D6) + "decrements by the
// configured dose and never drives stock negative" (D-H.2) — end-to-end,
// mirroring `catalogo-ajustes-precio.e2e-spec.ts`'s override shape (the
// closest catalogo analog: a mutating use case that wraps
// `runInTransaction` and publishes after commit): REAL
// `AuthGuard`/`ValidationPipe`/`ConsumoExceptionFilter`, only
// `ACTOR_PORT`/`CONSUMPTION_REPOSITORY`/`CONSUMPTION_LOG_REPOSITORY`/
// `EVENT_PUBLISHER`/`TRANSACTION_MANAGER` overridden — no local Supabase
// required (this PR's opt-in `consumo-descontar-stock.integration-spec.ts`
// proves the real SQL clamp against Postgres separately, task 4.14).
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

function buildConsumption(
  overrides: Partial<UserConsumption> & { id: string; userId: string },
): UserConsumption {
  return {
    ownerType: 'self',
    kind: 'medicamento',
    nombre: 'Losartan',
    dosisPorToma: 2,
    frecuenciaDias: 1,
    horarios: ['08:00'],
    stockActual: 10,
    autoCrearRefill: false,
    ...overrides,
  };
}

describe('Consumo — POST /consumo/mis-consumos/:consumptionId/dosis (e2e)', () => {
  let app: INestApplication;
  let actorPort: jest.Mocked<ActorPort>;
  let consumptionRepository: jest.Mocked<ConsumptionRepository>;
  let consumptionLogRepository: jest.Mocked<ConsumptionLogRepository>;
  let eventPublisher: jest.Mocked<EventPublisher>;
  let transactionManager: jest.Mocked<TransactionManager>;

  beforeAll(async () => {
    actorPort = { findActorById: jest.fn() };
    consumptionRepository = {
      save: jest.fn(),
      findById: jest.fn(),
      findDueForCheck: jest.fn(),
      intentarMarcarStockBajo: jest.fn(),
      limpiarMarcaStockBajo: jest.fn(),
      descontarStock: jest.fn(),
      findByUserId: jest.fn(),
    };
    consumptionLogRepository = {
      append: jest.fn().mockResolvedValue(undefined),
      adherenciaUltimos7Dias: jest.fn(),
      contarTomasPorDia: jest.fn(),
    };
    eventPublisher = { publish: jest.fn().mockResolvedValue(undefined) };
    const fakeTx = {} as TransactionContext;
    transactionManager = {
      runInTransaction: jest.fn().mockImplementation((work) => work(fakeTx)),
    };

    const moduleRef = await Test.createTestingModule({ imports: [AppModule] })
      .overrideProvider(ACTOR_PORT)
      .useValue(actorPort)
      .overrideProvider(CONSUMPTION_REPOSITORY)
      .useValue(consumptionRepository)
      .overrideProvider(CONSUMPTION_LOG_REPOSITORY)
      .useValue(consumptionLogRepository)
      .overrideProvider(EVENT_PUBLISHER)
      .useValue(eventPublisher)
      .overrideProvider(TRANSACTION_MANAGER)
      .useValue(transactionManager)
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

  it('204s, decrements by dosisPorToma, appends the log, and publishes DosisRegistrada after commit — happy path', async () => {
    const profileId = randomUUID();
    const consumptionId = randomUUID();
    const consumption = buildConsumption({
      id: consumptionId,
      userId: profileId,
      dosisPorToma: 2,
      stockActual: 10,
    });
    actorPort.findActorById.mockResolvedValueOnce(buildUserActor({ profileId }));
    consumptionRepository.findById.mockResolvedValueOnce(consumption);
    consumptionRepository.descontarStock.mockResolvedValueOnce(8);
    const token = await signToken(profileId);

    await request(app.getHttpServer())
      .post(`/consumo/mis-consumos/${consumptionId}/dosis`)
      .set('Authorization', `Bearer ${token}`)
      .send({})
      .expect(204);

    expect(consumptionLogRepository.append).toHaveBeenCalledWith(
      expect.objectContaining({ consumptionId, cantidad: 2 }),
      expect.anything(),
    );
    expect(consumptionRepository.descontarStock).toHaveBeenCalledWith(
      consumptionId,
      2,
      expect.anything(),
    );
    expect(eventPublisher.publish).toHaveBeenCalledWith(
      expect.objectContaining({
        type: 'consumo.dosis_registrada',
        consumptionId,
        userId: profileId,
        cantidad: 2,
        stockRestante: 8,
      }),
    );
  });

  it('returns 404 CONSUMPTION_NOT_FOUND — never 403 — for a cross-tenant consumption, and mutates nothing', async () => {
    const profileId = randomUUID();
    const ownerProfileId = randomUUID();
    const consumptionId = randomUUID();
    const consumption = buildConsumption({ id: consumptionId, userId: ownerProfileId });
    actorPort.findActorById.mockResolvedValueOnce(buildUserActor({ profileId }));
    consumptionRepository.findById.mockResolvedValueOnce(consumption);
    const token = await signToken(profileId);

    const res = await request(app.getHttpServer())
      .post(`/consumo/mis-consumos/${consumptionId}/dosis`)
      .set('Authorization', `Bearer ${token}`)
      .send({})
      .expect(404);

    expect(res.body).toMatchObject({ statusCode: 404, code: 'CONSUMPTION_NOT_FOUND' });
    expect(consumptionLogRepository.append).not.toHaveBeenCalled();
    expect(consumptionRepository.descontarStock).not.toHaveBeenCalled();
    expect(eventPublisher.publish).not.toHaveBeenCalled();
  });

  it('returns 404 for a genuinely missing consumption — byte-identical to the cross-tenant case', async () => {
    const profileId = randomUUID();
    actorPort.findActorById.mockResolvedValueOnce(buildUserActor({ profileId }));
    consumptionRepository.findById.mockResolvedValueOnce(null);
    const token = await signToken(profileId);

    const res = await request(app.getHttpServer())
      .post(`/consumo/mis-consumos/${randomUUID()}/dosis`)
      .set('Authorization', `Bearer ${token}`)
      .send({})
      .expect(404);

    expect(res.body).toMatchObject({ statusCode: 404, code: 'CONSUMPTION_NOT_FOUND' });
  });

  it('returns 400 DOSIS_INVALIDA for a tomadoAt in the future, and never opens the transaction', async () => {
    const profileId = randomUUID();
    const consumptionId = randomUUID();
    actorPort.findActorById.mockResolvedValueOnce(buildUserActor({ profileId }));
    const token = await signToken(profileId);
    const farFuture = new Date(Date.now() + 60 * 60 * 1000).toISOString();

    const res = await request(app.getHttpServer())
      .post(`/consumo/mis-consumos/${consumptionId}/dosis`)
      .set('Authorization', `Bearer ${token}`)
      .send({ tomadoAt: farFuture })
      .expect(400);

    expect(res.body).toMatchObject({ statusCode: 400, code: 'DOSIS_INVALIDA' });
    expect(transactionManager.runInTransaction).not.toHaveBeenCalled();
    expect(consumptionRepository.findById).not.toHaveBeenCalled();
  });

  it('clamps to 0, never negative, when descontarStock resolves 0 (SQL-level clamp, D-H.2) — still 204, dose still recorded', async () => {
    const profileId = randomUUID();
    const consumptionId = randomUUID();
    const consumption = buildConsumption({
      id: consumptionId,
      userId: profileId,
      stockActual: 1,
      dosisPorToma: 5,
    });
    actorPort.findActorById.mockResolvedValueOnce(buildUserActor({ profileId }));
    consumptionRepository.findById.mockResolvedValueOnce(consumption);
    consumptionRepository.descontarStock.mockResolvedValueOnce(0);
    const token = await signToken(profileId);

    await request(app.getHttpServer())
      .post(`/consumo/mis-consumos/${consumptionId}/dosis`)
      .set('Authorization', `Bearer ${token}`)
      .send({})
      .expect(204);

    expect(consumptionLogRepository.append).toHaveBeenCalledTimes(1);
    expect(eventPublisher.publish).toHaveBeenCalledWith(
      expect.objectContaining({ stockRestante: 0 }),
    );
  });

  it('rejects a client-supplied cantidad with 400 — the DTO has no such field (D-H.2)', async () => {
    const profileId = randomUUID();
    const consumptionId = randomUUID();
    actorPort.findActorById.mockResolvedValueOnce(buildUserActor({ profileId }));
    const token = await signToken(profileId);

    const res = await request(app.getHttpServer())
      .post(`/consumo/mis-consumos/${consumptionId}/dosis`)
      .set('Authorization', `Bearer ${token}`)
      .send({ cantidad: 999 })
      .expect(400);

    expect(res.body).toMatchObject({ statusCode: 400 });
    expect(consumptionRepository.findById).not.toHaveBeenCalled();
  });

  it('rejects an unauthenticated request with 401', () => {
    return request(app.getHttpServer())
      .post(`/consumo/mis-consumos/${randomUUID()}/dosis`)
      .send({})
      .expect(401)
      .expect((res) => {
        expect(res.body).toMatchObject({ statusCode: 401, code: 'MISSING_BEARER_TOKEN' });
      });
  });

  it('rejects a non-UUID consumptionId with 400 (ParseUUIDPipe)', async () => {
    const profileId = randomUUID();
    actorPort.findActorById.mockResolvedValueOnce(buildUserActor({ profileId }));
    const token = await signToken(profileId);

    await request(app.getHttpServer())
      .post('/consumo/mis-consumos/not-a-uuid/dosis')
      .set('Authorization', `Bearer ${token}`)
      .send({})
      .expect(400);

    expect(consumptionRepository.findById).not.toHaveBeenCalled();
  });
});
