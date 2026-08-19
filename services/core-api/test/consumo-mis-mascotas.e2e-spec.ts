import { randomUUID } from 'node:crypto';
import { INestApplication, ValidationPipe } from '@nestjs/common';
import { Test } from '@nestjs/testing';
import { SignJWT } from 'jose';
import request from 'supertest';
import { AppModule } from '../src/app.module';
import {
  CONSUMPTION_REPOSITORY,
  type ConsumptionRepository,
} from '../src/domains/consumo/ports-out/consumption-repository.port';
import {
  PET_REPOSITORY,
  type PetRepository,
} from '../src/domains/consumo/ports-out/pet-repository.port';
import { GlobalExceptionFilter } from '../src/shared/auth/global-exception.filter';
import {
  ACTOR_PORT,
  type ActorPort,
  type AuthenticatedActor,
} from '../src/shared/auth/ports/actor.port';

// core-api-consumo spec: "registrarMascota and configurarConsumo derive
// userId exclusively from the actor" (D8). Same "override the port, keep
// the wiring real" approach as `catalogo-mi-catalogo.e2e-spec.ts`: exercises
// the REAL `AuthGuard`/`ValidationPipe`/`ConsumoExceptionFilter`, only
// overriding `ACTOR_PORT`/`PET_REPOSITORY`/`CONSUMPTION_REPOSITORY` (no
// local Supabase required). This is also the e2e proof that a
// client-supplied `userId` field is rejected by the SAME global
// `ValidationPipe({ whitelist: true, forbidNonWhitelisted: true })`
// `main.ts` configures — 400, never silently stripped, never reaching the
// use case.
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

describe('Consumo — POST /consumo/mis-mascotas (e2e)', () => {
  let app: INestApplication;
  let actorPort: jest.Mocked<ActorPort>;
  let petRepository: jest.Mocked<PetRepository>;
  let consumptionRepository: jest.Mocked<ConsumptionRepository>;

  beforeAll(async () => {
    actorPort = { findActorById: jest.fn() };
    petRepository = {
      save: jest.fn().mockResolvedValue(undefined),
      findById: jest.fn(),
      findByUserId: jest.fn(),
    };
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
      .overrideProvider(PET_REPOSITORY)
      .useValue(petRepository)
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

  const validNuevaMascota = {
    nombre: 'Firulais',
    especie: 'perro',
    raza: 'Labrador',
    pesoKg: 25.5,
  };

  it('creates the Pet scoped to actor.profileId and returns it — happy path (201)', async () => {
    const profileId = randomUUID();
    actorPort.findActorById.mockResolvedValueOnce(buildUserActor({ profileId }));
    const token = await signToken(profileId);

    const res = await request(app.getHttpServer())
      .post('/consumo/mis-mascotas')
      .set('Authorization', `Bearer ${token}`)
      .send(validNuevaMascota)
      .expect(201);

    expect(res.body).toMatchObject({ userId: profileId, ...validNuevaMascota });
    expect(petRepository.save).toHaveBeenCalledWith(
      expect.objectContaining({ userId: profileId, nombre: 'Firulais' }),
    );
  });

  it('rejects a client-supplied userId with 400 — the DTO has no such field, whitelist strips-then-forbids it (D8)', async () => {
    const profileId = randomUUID();
    actorPort.findActorById.mockResolvedValueOnce(buildUserActor({ profileId }));
    const token = await signToken(profileId);

    const res = await request(app.getHttpServer())
      .post('/consumo/mis-mascotas')
      .set('Authorization', `Bearer ${token}`)
      .send({ ...validNuevaMascota, userId: randomUUID() })
      .expect(400);

    expect(res.body).toMatchObject({ statusCode: 400 });
    expect(petRepository.save).not.toHaveBeenCalled();
  });

  it('rejects an empty nombre with 400 (MASCOTA_INVALIDA, via the entity)', async () => {
    const profileId = randomUUID();
    actorPort.findActorById.mockResolvedValueOnce(buildUserActor({ profileId }));
    const token = await signToken(profileId);

    const res = await request(app.getHttpServer())
      .post('/consumo/mis-mascotas')
      .set('Authorization', `Bearer ${token}`)
      .send({ nombre: '', especie: 'perro' })
      .expect(400);

    expect(res.body).toMatchObject({ statusCode: 400 });
    expect(petRepository.save).not.toHaveBeenCalled();
  });

  it('rejects an unauthenticated request with 401', () => {
    return request(app.getHttpServer())
      .post('/consumo/mis-mascotas')
      .send(validNuevaMascota)
      .expect(401)
      .expect((res) => {
        expect(res.body).toMatchObject({ statusCode: 401, code: 'MISSING_BEARER_TOKEN' });
      });
  });
});
