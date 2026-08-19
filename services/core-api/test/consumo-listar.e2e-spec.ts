import { randomUUID } from 'node:crypto';
import { INestApplication, ValidationPipe } from '@nestjs/common';
import { Test } from '@nestjs/testing';
import type { Pet, UserConsumption } from '@repon/types';
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

// usuario-mobile-consumo design.md D-1/D-4/D-5/D7: `GET /consumo/mis-mascotas`
// and `GET /consumo/mis-consumos`. Same "override the port, keep the wiring
// real" approach as the existing `consumo-mis-mascotas.e2e-spec.ts` (no
// local Supabase required). The mocked repositories here are keyed by
// `userId` so a cross-tenant leak would be directly observable: if the
// controller ever passed the wrong id (or a client-supplied one), the
// response would visibly contain the wrong user's rows.
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

function buildPet(userId: string, overrides: Partial<Pet> = {}): Pet {
  return { id: randomUUID(), userId, nombre: 'Firulais', especie: 'perro', ...overrides };
}

function buildConsumption(userId: string, overrides: Partial<UserConsumption> = {}): UserConsumption {
  return {
    id: randomUUID(),
    userId,
    ownerType: 'self',
    kind: 'medicamento',
    nombre: 'Losartan',
    dosisPorToma: 2,
    frecuenciaDias: 1,
    horarios: ['08:00', '20:00'],
    stockActual: 10,
    autoCrearRefill: false,
    ...overrides,
  };
}

describe('Consumo — GET /consumo/mis-mascotas + GET /consumo/mis-consumos (e2e)', () => {
  let app: INestApplication;
  let actorPort: jest.Mocked<ActorPort>;
  let petRepository: jest.Mocked<PetRepository>;
  let consumptionRepository: jest.Mocked<ConsumptionRepository>;

  beforeAll(async () => {
    actorPort = { findActorById: jest.fn() };
    petRepository = { save: jest.fn(), findById: jest.fn(), findByUserId: jest.fn() };
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

  describe('GET /consumo/mis-mascotas', () => {
    it("returns only the caller's own pets — a cross-tenant world leaks nothing", async () => {
      const userA = randomUUID();
      const userB = randomUUID();
      const petsByUser: Record<string, Pet[]> = {
        [userA]: [buildPet(userA, { nombre: 'A-pet' })],
        [userB]: [buildPet(userB, { nombre: 'B-pet' })],
      };
      petRepository.findByUserId.mockImplementation(async (userId) => petsByUser[userId] ?? []);
      actorPort.findActorById.mockResolvedValueOnce(buildUserActor({ profileId: userA }));
      const token = await signToken(userA);

      const res = await request(app.getHttpServer())
        .get('/consumo/mis-mascotas')
        .set('Authorization', `Bearer ${token}`)
        .expect(200);

      expect(res.body).toHaveLength(1);
      expect(res.body[0]).toMatchObject({ nombre: 'A-pet', userId: userA });
      expect(petRepository.findByUserId).toHaveBeenCalledWith(userA);
    });

    it('a userId/petId query param changes nothing — scope is always actor.profileId', async () => {
      const userA = randomUUID();
      const userB = randomUUID();
      petRepository.findByUserId.mockResolvedValue([buildPet(userA)]);
      actorPort.findActorById.mockResolvedValueOnce(buildUserActor({ profileId: userA }));
      const token = await signToken(userA);

      await request(app.getHttpServer())
        .get(`/consumo/mis-mascotas?userId=${userB}&petId=${randomUUID()}`)
        .set('Authorization', `Bearer ${token}`)
        .expect(200);

      expect(petRepository.findByUserId).toHaveBeenCalledWith(userA);
      expect(petRepository.findByUserId).not.toHaveBeenCalledWith(userB);
    });

    it('a user with no pets gets 200 [], never 404', async () => {
      const userA = randomUUID();
      petRepository.findByUserId.mockResolvedValue([]);
      actorPort.findActorById.mockResolvedValueOnce(buildUserActor({ profileId: userA }));
      const token = await signToken(userA);

      const res = await request(app.getHttpServer())
        .get('/consumo/mis-mascotas')
        .set('Authorization', `Bearer ${token}`)
        .expect(200);

      expect(res.body).toEqual([]);
    });

    it('rejects an unauthenticated request with 401', () => {
      return request(app.getHttpServer())
        .get('/consumo/mis-mascotas')
        .expect(401)
        .expect((res) => {
          expect(res.body).toMatchObject({ statusCode: 401, code: 'MISSING_BEARER_TOKEN' });
        });
    });
  });

  describe('GET /consumo/mis-consumos', () => {
    it("returns only the caller's own consumptions, each carrying a server-computed diasRestantes", async () => {
      const userA = randomUUID();
      const userB = randomUUID();
      const consumptionsByUser: Record<string, UserConsumption[]> = {
        [userA]: [buildConsumption(userA, { nombre: 'A-item' })],
        [userB]: [buildConsumption(userB, { nombre: 'B-item' })],
      };
      consumptionRepository.findByUserId.mockImplementation(
        async (userId) => consumptionsByUser[userId] ?? [],
      );
      actorPort.findActorById.mockResolvedValueOnce(buildUserActor({ profileId: userA }));
      const token = await signToken(userA);

      const res = await request(app.getHttpServer())
        .get('/consumo/mis-consumos')
        .set('Authorization', `Bearer ${token}`)
        .expect(200);

      expect(res.body).toHaveLength(1);
      expect(res.body[0]).toMatchObject({ nombre: 'A-item', userId: userA });
      expect(typeof res.body[0].diasRestantes).toBe('number');
      // stockActual(10) / consumoDiario(2*2/1=4) = 2.5 -> floor = 2.
      expect(res.body[0].diasRestantes).toBe(2);
    });

    it('a degenerate row never serializes as JSON null — the mapper guard sanitizes to 0', async () => {
      const userA = randomUUID();
      consumptionRepository.findByUserId.mockResolvedValue([
        buildConsumption(userA, { horarios: [] as never }),
      ]);
      actorPort.findActorById.mockResolvedValueOnce(buildUserActor({ profileId: userA }));
      const token = await signToken(userA);

      const res = await request(app.getHttpServer())
        .get('/consumo/mis-consumos')
        .set('Authorization', `Bearer ${token}`)
        .expect(200);

      expect(res.body[0].diasRestantes).toBe(0);
    });

    it('a userId query param changes nothing — scope is always actor.profileId', async () => {
      const userA = randomUUID();
      const userB = randomUUID();
      consumptionRepository.findByUserId.mockResolvedValue([buildConsumption(userA)]);
      actorPort.findActorById.mockResolvedValueOnce(buildUserActor({ profileId: userA }));
      const token = await signToken(userA);

      await request(app.getHttpServer())
        .get(`/consumo/mis-consumos?userId=${userB}`)
        .set('Authorization', `Bearer ${token}`)
        .expect(200);

      expect(consumptionRepository.findByUserId).toHaveBeenCalledWith(userA);
      expect(consumptionRepository.findByUserId).not.toHaveBeenCalledWith(userB);
    });

    it('a user with no consumptions gets 200 [], never 404', async () => {
      const userA = randomUUID();
      consumptionRepository.findByUserId.mockResolvedValue([]);
      actorPort.findActorById.mockResolvedValueOnce(buildUserActor({ profileId: userA }));
      const token = await signToken(userA);

      const res = await request(app.getHttpServer())
        .get('/consumo/mis-consumos')
        .set('Authorization', `Bearer ${token}`)
        .expect(200);

      expect(res.body).toEqual([]);
    });

    it('rejects an unauthenticated request with 401', () => {
      return request(app.getHttpServer())
        .get('/consumo/mis-consumos')
        .expect(401)
        .expect((res) => {
          expect(res.body).toMatchObject({ statusCode: 401, code: 'MISSING_BEARER_TOKEN' });
        });
    });
  });
});
