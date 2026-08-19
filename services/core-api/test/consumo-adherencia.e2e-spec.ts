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

// usuario-mobile-consumo design.md D-1/D-2/D-4: `GET /consumo/mi-adherencia`.
// Same "override the port, keep the wiring real" approach as
// `consumo-listar.e2e-spec.ts`. `ConsumptionLogRepository.contarTomasPorDia`
// is mocked at the repository boundary — the window-exclusion behaviour
// itself (the SQL `WHERE tomado_at >= desde AND < hasta`) is already proven
// in `kysely-consumption-log.repository.spec.ts` (PR2); this file proves the
// USE CASE only ever credits a fecha that's actually inside the 7-day
// window it computed, never trusting an out-of-window row the mock might
// (incorrectly) return.
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

function buildConsumption(userId: string, overrides: Partial<UserConsumption> = {}): UserConsumption {
  return {
    id: randomUUID(),
    userId,
    ownerType: 'self',
    kind: 'medicamento',
    nombre: 'Losartan',
    dosisPorToma: 1,
    frecuenciaDias: 1,
    horarios: ['08:00'],
    stockActual: 10,
    autoCrearRefill: false,
    ...overrides,
  };
}

describe('Consumo — GET /consumo/mi-adherencia (e2e)', () => {
  let app: INestApplication;
  let actorPort: jest.Mocked<ActorPort>;
  let consumptionRepository: jest.Mocked<ConsumptionRepository>;
  let consumptionLogRepository: jest.Mocked<ConsumptionLogRepository>;

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
      append: jest.fn(),
      adherenciaUltimos7Dias: jest.fn(),
      contarTomasPorDia: jest.fn(),
    };

    const moduleRef = await Test.createTestingModule({ imports: [AppModule] })
      .overrideProvider(ACTOR_PORT)
      .useValue(actorPort)
      .overrideProvider(CONSUMPTION_REPOSITORY)
      .useValue(consumptionRepository)
      .overrideProvider(CONSUMPTION_LOG_REPOSITORY)
      .useValue(consumptionLogRepository)
      .compile();

    app = moduleRef.createNestApplication();
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

  it('a user with zero consumptions gets the full empty skeleton — items: [], 7x sin_datos, 0%, 0 racha — never 404/null', async () => {
    const userA = randomUUID();
    consumptionRepository.findByUserId.mockResolvedValue([]);
    consumptionLogRepository.contarTomasPorDia.mockResolvedValue([]);
    actorPort.findActorById.mockResolvedValueOnce(buildUserActor({ profileId: userA }));
    const token = await signToken(userA);

    const res = await request(app.getHttpServer())
      .get('/consumo/mi-adherencia')
      .set('Authorization', `Bearer ${token}`)
      .expect(200);

    expect(res.body.items).toEqual([]);
    expect(res.body.dias).toHaveLength(7);
    expect(res.body.dias.every((dia: { estado: string }) => dia.estado === 'sin_datos')).toBe(true);
    expect(res.body.porcentaje).toBe(0);
    expect(res.body.rachaDias).toBe(0);
  });

  it('a user WITH consumptions but zero logs gets a populated items list, all incumplido — never crashes, never treats it as the empty-consumptions case', async () => {
    const userA = randomUUID();
    consumptionRepository.findByUserId.mockResolvedValue([buildConsumption(userA)]);
    consumptionLogRepository.contarTomasPorDia.mockResolvedValue([]);
    actorPort.findActorById.mockResolvedValueOnce(buildUserActor({ profileId: userA }));
    const token = await signToken(userA);

    const res = await request(app.getHttpServer())
      .get('/consumo/mi-adherencia')
      .set('Authorization', `Bearer ${token}`)
      .expect(200);

    expect(res.body.items).toHaveLength(1);
    expect(res.body.items[0].dias.every((dia: { estado: string }) => dia.estado === 'incumplido')).toBe(
      true,
    );
    expect(res.body.porcentaje).toBe(0);
  });

  it("returns only the caller's own items — a cross-tenant world leaks nothing", async () => {
    const userA = randomUUID();
    const userB = randomUUID();
    const consumptionsByUser: Record<string, UserConsumption[]> = {
      [userA]: [buildConsumption(userA, { nombre: 'A-item' })],
      [userB]: [buildConsumption(userB, { nombre: 'B-item' })],
    };
    consumptionRepository.findByUserId.mockImplementation(
      async (userId) => consumptionsByUser[userId] ?? [],
    );
    consumptionLogRepository.contarTomasPorDia.mockResolvedValue([]);
    actorPort.findActorById.mockResolvedValueOnce(buildUserActor({ profileId: userA }));
    const token = await signToken(userA);

    const res = await request(app.getHttpServer())
      .get('/consumo/mi-adherencia')
      .set('Authorization', `Bearer ${token}`)
      .expect(200);

    expect(res.body.items).toHaveLength(1);
    expect(res.body.items[0].nombre).toBe('A-item');
  });

  it('the consumptionLogRepository is never queried with a foreign id — the id set comes only from findByUserId (D-4)', async () => {
    const userA = randomUUID();
    const own = buildConsumption(userA, { id: 'own-id' });
    consumptionRepository.findByUserId.mockResolvedValue([own]);
    consumptionLogRepository.contarTomasPorDia.mockResolvedValue([]);
    actorPort.findActorById.mockResolvedValueOnce(buildUserActor({ profileId: userA }));
    const token = await signToken(userA);

    await request(app.getHttpServer())
      .get('/consumo/mi-adherencia?consumptionId=foreign-id')
      .set('Authorization', `Bearer ${token}`)
      .expect(200);

    const [idsArg] = consumptionLogRepository.contarTomasPorDia.mock.calls[0]!;
    expect(idsArg).toEqual(['own-id']);
  });

  it('a log outside the 7-day window is not credited — the use case only counts fechas inside its own computed window', async () => {
    const userA = randomUUID();
    consumptionRepository.findByUserId.mockResolvedValue([buildConsumption(userA, { id: 'c-1' })]);
    // Simulates a misbehaving repository returning a row outside any real
    // 7-day window ending "today" — proves the use case doesn't blindly
    // trust every row the repository hands back, only fechas in `fechas`.
    consumptionLogRepository.contarTomasPorDia.mockResolvedValue([
      { consumptionId: 'c-1', fecha: '2020-01-01', tomadas: 99 },
    ]);
    actorPort.findActorById.mockResolvedValueOnce(buildUserActor({ profileId: userA }));
    const token = await signToken(userA);

    const res = await request(app.getHttpServer())
      .get('/consumo/mi-adherencia')
      .set('Authorization', `Bearer ${token}`)
      .expect(200);

    expect(res.body.items[0].tomadas).toBe(0);
    expect(res.body.dias.every((dia: { tomadas: number }) => dia.tomadas === 0)).toBe(true);
  });

  it('rejects an unauthenticated request with 401', () => {
    return request(app.getHttpServer())
      .get('/consumo/mi-adherencia')
      .expect(401)
      .expect((res) => {
        expect(res.body).toMatchObject({ statusCode: 401, code: 'MISSING_BEARER_TOKEN' });
      });
  });
});
