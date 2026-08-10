import { randomUUID } from 'node:crypto';
import { INestApplication, ValidationPipe } from '@nestjs/common';
import { Test } from '@nestjs/testing';
import type { Pet } from '@repon/types';
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

// core-api-consumo spec: "configurarConsumo verifies a client-supplied
// petId belongs to the same user, before creating the consumption" (D-H.3)
// — this is the end-to-end proof, mirroring `consumo-dias-restantes.e2e-spec.ts`'s
// R1 proof and `catalogo-mi-catalogo.e2e-spec.ts`'s cross-tenant pattern:
// exercises the REAL `AuthGuard`/`ValidationPipe`/`ConsumoExceptionFilter`,
// only overriding `ACTOR_PORT`/`PET_REPOSITORY`/`CONSUMPTION_REPOSITORY` (no
// local Supabase required).
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

function buildPet(overrides: Partial<Pet> & { id: string; userId: string }): Pet {
  return { nombre: 'Firulais', especie: 'perro', ...overrides };
}

describe('Consumo — POST /consumo/mis-consumos (e2e)', () => {
  let app: INestApplication;
  let actorPort: jest.Mocked<ActorPort>;
  let petRepository: jest.Mocked<PetRepository>;
  let consumptionRepository: jest.Mocked<ConsumptionRepository>;

  beforeAll(async () => {
    actorPort = { findActorById: jest.fn() };
    petRepository = { save: jest.fn(), findById: jest.fn() };
    consumptionRepository = {
      save: jest.fn().mockResolvedValue(undefined),
      findById: jest.fn(),
      findDueForCheck: jest.fn(),
      intentarMarcarStockBajo: jest.fn(),
      limpiarMarcaStockBajo: jest.fn(),
      descontarStock: jest.fn(),
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

  const validConsumoPropio = {
    ownerType: 'self',
    kind: 'medicamento',
    nombre: 'Losartan',
    dosisPorToma: 1,
    unidad: 'mg',
    frecuenciaDias: 1,
    horarios: ['08:00'],
    stockActual: 10,
    autoCrearRefill: false,
  };

  it('creates the UserConsumption scoped to actor.profileId and returns it — happy path, ownerType self (201)', async () => {
    const profileId = randomUUID();
    actorPort.findActorById.mockResolvedValueOnce(buildUserActor({ profileId }));
    const token = await signToken(profileId);

    const res = await request(app.getHttpServer())
      .post('/consumo/mis-consumos')
      .set('Authorization', `Bearer ${token}`)
      .send(validConsumoPropio)
      .expect(201);

    expect(res.body).toMatchObject({ userId: profileId, ...validConsumoPropio });
    expect(consumptionRepository.save).toHaveBeenCalledWith(
      expect.objectContaining({ userId: profileId }),
    );
    expect(petRepository.findById).not.toHaveBeenCalled();
  });

  it("creates the UserConsumption scoped to the caller's own pet — happy path, ownerType pet (201)", async () => {
    const profileId = randomUUID();
    const petId = randomUUID();
    actorPort.findActorById.mockResolvedValueOnce(buildUserActor({ profileId }));
    petRepository.findById.mockResolvedValueOnce(buildPet({ id: petId, userId: profileId }));
    const token = await signToken(profileId);

    const res = await request(app.getHttpServer())
      .post('/consumo/mis-consumos')
      .set('Authorization', `Bearer ${token}`)
      .send({ ...validConsumoPropio, ownerType: 'pet', petId })
      .expect(201);

    expect(res.body).toMatchObject({ userId: profileId, petId });
    expect(consumptionRepository.save).toHaveBeenCalledWith(
      expect.objectContaining({ userId: profileId, petId }),
    );
  });

  it('returns 404 PET_NOT_FOUND — never 403 — for a petId belonging to another user, and creates NO UserConsumption (D-H.3)', async () => {
    const profileId = randomUUID();
    const petId = randomUUID();
    actorPort.findActorById.mockResolvedValueOnce(buildUserActor({ profileId }));
    petRepository.findById.mockResolvedValueOnce(
      buildPet({ id: petId, userId: randomUUID() /* another user */ }),
    );
    const token = await signToken(profileId);

    const res = await request(app.getHttpServer())
      .post('/consumo/mis-consumos')
      .set('Authorization', `Bearer ${token}`)
      .send({ ...validConsumoPropio, ownerType: 'pet', petId })
      .expect(404);

    expect(res.body).toMatchObject({ statusCode: 404, code: 'PET_NOT_FOUND' });
    expect(consumptionRepository.save).not.toHaveBeenCalled();
  });

  it('returns 404 PET_NOT_FOUND for a genuinely missing petId — byte-identical to the cross-tenant case', async () => {
    const profileId = randomUUID();
    const petId = randomUUID();
    actorPort.findActorById.mockResolvedValueOnce(buildUserActor({ profileId }));
    petRepository.findById.mockResolvedValueOnce(null);
    const token = await signToken(profileId);

    const res = await request(app.getHttpServer())
      .post('/consumo/mis-consumos')
      .set('Authorization', `Bearer ${token}`)
      .send({ ...validConsumoPropio, ownerType: 'pet', petId })
      .expect(404);

    expect(res.body).toMatchObject({ statusCode: 404, code: 'PET_NOT_FOUND' });
    expect(consumptionRepository.save).not.toHaveBeenCalled();
  });

  it('rejects a client-supplied userId with 400 — the DTO has no such field, whitelist strips-then-forbids it (D8)', async () => {
    const profileId = randomUUID();
    actorPort.findActorById.mockResolvedValueOnce(buildUserActor({ profileId }));
    const token = await signToken(profileId);

    const res = await request(app.getHttpServer())
      .post('/consumo/mis-consumos')
      .set('Authorization', `Bearer ${token}`)
      .send({ ...validConsumoPropio, userId: randomUUID() })
      .expect(400);

    expect(res.body).toMatchObject({ statusCode: 400 });
    expect(consumptionRepository.save).not.toHaveBeenCalled();
  });

  it('rejects an empty horarios array with 400 (CONSUMO_INVALIDO, via the entity)', async () => {
    const profileId = randomUUID();
    actorPort.findActorById.mockResolvedValueOnce(buildUserActor({ profileId }));
    const token = await signToken(profileId);

    const res = await request(app.getHttpServer())
      .post('/consumo/mis-consumos')
      .set('Authorization', `Bearer ${token}`)
      .send({ ...validConsumoPropio, horarios: [] })
      .expect(400);

    expect(res.body).toMatchObject({ statusCode: 400 });
    expect(consumptionRepository.save).not.toHaveBeenCalled();
  });

  it('rejects an unauthenticated request with 401', () => {
    return request(app.getHttpServer())
      .post('/consumo/mis-consumos')
      .send(validConsumoPropio)
      .expect(401)
      .expect((res) => {
        expect(res.body).toMatchObject({ statusCode: 401, code: 'MISSING_BEARER_TOKEN' });
      });
  });
});
