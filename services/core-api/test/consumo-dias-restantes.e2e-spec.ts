import { randomUUID } from 'node:crypto';
import { INestApplication, ValidationPipe } from '@nestjs/common';
import { Test } from '@nestjs/testing';
import type { UserConsumption } from '@repon/types';
import { SignJWT } from 'jose';
import request from 'supertest';
import { AppModule } from '../src/app.module';
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

// core-api-consumo spec: this is the end-to-end proof of R1 (design.md
// Diagram 3) — "calcularDiasRestantes is scoped to the caller's own
// consumption; cross-tenant access is a 404, never 403". Same "override the
// port, keep the wiring real" approach as `catalogo-mi-catalogo.e2e-spec.ts`:
// exercises the REAL `AuthGuard`/`ValidationPipe`/`ConsumoExceptionFilter`,
// only overriding `ACTOR_PORT` and `CONSUMPTION_REPOSITORY` (no local
// Supabase required).
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

function buildConsumption(overrides: Partial<UserConsumption>): UserConsumption {
  return {
    id: randomUUID(),
    userId: randomUUID(),
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

describe('Consumo — GET /consumo/mis-consumos/:consumptionId/dias-restantes (e2e)', () => {
  let app: INestApplication;
  let actorPort: jest.Mocked<ActorPort>;
  let consumptionRepository: jest.Mocked<ConsumptionRepository>;

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

    const moduleRef = await Test.createTestingModule({ imports: [AppModule] })
      .overrideProvider(ACTOR_PORT)
      .useValue(actorPort)
      .overrideProvider(CONSUMPTION_REPOSITORY)
      .useValue(consumptionRepository)
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

  it('200s with diasRestantes when the actor owns the consumption — happy path', async () => {
    const profileId = randomUUID();
    const consumption = buildConsumption({ userId: profileId, stockActual: 10, dosisPorToma: 1 });
    actorPort.findActorById.mockResolvedValueOnce(buildUserActor({ profileId }));
    consumptionRepository.findById.mockResolvedValueOnce(consumption);
    const token = await signToken(profileId);

    const res = await request(app.getHttpServer())
      .get(`/consumo/mis-consumos/${consumption.id}/dias-restantes`)
      .set('Authorization', `Bearer ${token}`)
      .expect(200);

    expect(res.body).toEqual({ diasRestantes: 10 });
    expect(consumptionRepository.findById).toHaveBeenCalledWith(consumption.id);
  });

  it('returns 404 CONSUMPTION_NOT_FOUND — never 403 — for a cross-tenant consumption (R1)', async () => {
    const profileId = randomUUID();
    const ownerProfileId = randomUUID();
    const consumption = buildConsumption({ userId: ownerProfileId });
    actorPort.findActorById.mockResolvedValueOnce(buildUserActor({ profileId }));
    consumptionRepository.findById.mockResolvedValueOnce(consumption);
    const token = await signToken(profileId);

    const res = await request(app.getHttpServer())
      .get(`/consumo/mis-consumos/${consumption.id}/dias-restantes`)
      .set('Authorization', `Bearer ${token}`)
      .expect(404);

    expect(res.body).toMatchObject({ statusCode: 404, code: 'CONSUMPTION_NOT_FOUND' });
  });

  it('returns 404 CONSUMPTION_NOT_FOUND for a genuinely missing consumption — byte-identical to the cross-tenant case', async () => {
    const profileId = randomUUID();
    actorPort.findActorById.mockResolvedValueOnce(buildUserActor({ profileId }));
    consumptionRepository.findById.mockResolvedValueOnce(null);
    const token = await signToken(profileId);

    const res = await request(app.getHttpServer())
      .get(`/consumo/mis-consumos/${randomUUID()}/dias-restantes`)
      .set('Authorization', `Bearer ${token}`)
      .expect(404);

    expect(res.body).toMatchObject({ statusCode: 404, code: 'CONSUMPTION_NOT_FOUND' });
  });

  it('rejects an unauthenticated request with 401', () => {
    return request(app.getHttpServer())
      .get(`/consumo/mis-consumos/${randomUUID()}/dias-restantes`)
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
      .get('/consumo/mis-consumos/not-a-uuid/dias-restantes')
      .set('Authorization', `Bearer ${token}`)
      .expect(400);

    expect(consumptionRepository.findById).not.toHaveBeenCalled();
  });
});
