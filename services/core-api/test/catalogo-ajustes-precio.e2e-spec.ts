import { randomUUID } from 'node:crypto';
import { INestApplication, ValidationPipe } from '@nestjs/common';
import { Test } from '@nestjs/testing';
import type { ProviderCatalogItem } from '@repon/types';
import { SignJWT } from 'jose';
import request from 'supertest';
import { AppModule } from '../src/app.module';
import {
  CATALOG_REPOSITORY,
  type CatalogRepository,
} from '../src/domains/catalogo/ports-out/catalog-repository.port';
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

// core-api-catalogo spec, "ajustarPreciosPorCategoria scales both price
// bounds and preserves the price invariant" + "emits exactly one summary
// event" + "companyId is derived from the actor", end-to-end over the real
// HTTP pipeline (design.md "Mapa de transacciones" — this is the first
// mutating use case in this domain that wraps `runInTransaction`, so
// `TRANSACTION_MANAGER` is overridden with a fake that runs the work
// callback directly, same convention as `test/identidad.e2e-spec.ts`). Same
// "override the port, keep the wiring real" approach as every other e2e
// spec in this domain: exercises the REAL `AuthGuard`/`RolesGuard`/
// `ValidationPipe`/`CatalogoExceptionFilter`, only overriding `ACTOR_PORT`,
// `CATALOG_REPOSITORY`, `EVENT_PUBLISHER`, and `TRANSACTION_MANAGER`.
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

function buildItem(overrides: Partial<ProviderCatalogItem>): ProviderCatalogItem {
  return {
    id: randomUUID(),
    companyId: randomUUID(),
    nombre: 'Agua Purificada',
    categoria: 'Bebidas',
    precioBase: 1000,
    precioMaximo: 1500,
    stock: 10,
    disponible: true,
    ...overrides,
  };
}

describe('Catalogo — POST /catalogo/mi-catalogo/ajustes-de-precio (e2e)', () => {
  let app: INestApplication;
  let actorPort: jest.Mocked<ActorPort>;
  let catalogRepository: jest.Mocked<CatalogRepository>;
  let eventPublisher: jest.Mocked<EventPublisher>;
  let transactionManager: jest.Mocked<TransactionManager>;

  beforeAll(async () => {
    actorPort = { findActorById: jest.fn() };
    catalogRepository = {
      save: jest.fn().mockResolvedValue(undefined),
      saveMany: jest.fn().mockResolvedValue(undefined),
      findById: jest.fn(),
      findByCompany: jest.fn(),
      findByCompanyAndCategoria: jest.fn().mockResolvedValue([]),
      findMatching: jest.fn(),
    };
    eventPublisher = { publish: jest.fn().mockResolvedValue(undefined) };
    const fakeTx = {} as TransactionContext;
    transactionManager = {
      runInTransaction: jest.fn().mockImplementation((work) => work(fakeTx)),
    };

    const moduleRef = await Test.createTestingModule({ imports: [AppModule] })
      .overrideProvider(ACTOR_PORT)
      .useValue(actorPort)
      .overrideProvider(CATALOG_REPOSITORY)
      .useValue(catalogRepository)
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

  it('scales precioBase 1000 -> 1100 and precioMaximo 1500 -> 1650 at porcentaje: 10 (exact spec.md numbers), 204, publishes PreciosCategoriaAjustados', async () => {
    const profileId = randomUUID();
    const companyId = randomUUID();
    const item = buildItem({
      companyId,
      categoria: 'Bebidas',
      precioBase: 1000,
      precioMaximo: 1500,
    });
    actorPort.findActorById.mockResolvedValueOnce(buildProviderActor({ profileId, companyId }));
    catalogRepository.findByCompanyAndCategoria.mockResolvedValueOnce([item]);
    const token = await signToken(profileId);

    await request(app.getHttpServer())
      .post('/catalogo/mi-catalogo/ajustes-de-precio')
      .set('Authorization', `Bearer ${token}`)
      .send({ categoria: 'Bebidas', porcentaje: 10 })
      .expect(204);

    expect(catalogRepository.findByCompanyAndCategoria).toHaveBeenCalledWith(
      companyId,
      'Bebidas',
      expect.anything(),
    );
    expect(catalogRepository.saveMany).toHaveBeenCalledWith(
      [expect.objectContaining({ precioBase: 1100, precioMaximo: 1650 })],
      expect.anything(),
    );
    expect(eventPublisher.publish).toHaveBeenCalledWith(
      expect.objectContaining({
        type: 'catalogo.precios_categoria_ajustados',
        companyId,
        categoria: 'Bebidas',
        porcentaje: 10,
        totalActualizados: 1,
      }),
    );
  });

  it('rejects porcentaje <= -100 with 400 PORCENTAJE_INVALIDO before any repository call', async () => {
    const profileId = randomUUID();
    actorPort.findActorById.mockResolvedValueOnce(
      buildProviderActor({ profileId, companyId: randomUUID() }),
    );
    const token = await signToken(profileId);

    const res = await request(app.getHttpServer())
      .post('/catalogo/mi-catalogo/ajustes-de-precio')
      .set('Authorization', `Bearer ${token}`)
      .send({ categoria: 'Bebidas', porcentaje: -100 })
      .expect(400);

    expect(res.body).toMatchObject({ statusCode: 400, code: 'PORCENTAJE_INVALIDO' });
    expect(catalogRepository.findByCompanyAndCategoria).not.toHaveBeenCalled();
    expect(catalogRepository.saveMany).not.toHaveBeenCalled();
    expect(eventPublisher.publish).not.toHaveBeenCalled();
  });

  it("cross-company isolation: company B's items in the same categoria are never part of the saveMany call — the read itself is scoped to the actor's own companyId", async () => {
    const profileId = randomUUID();
    const companyA = randomUUID();
    const companyB = randomUUID();
    // The repository is mocked at the port boundary: a real
    // KyselyCatalogRepository.findByCompanyAndCategoria() only ever returns
    // rows WHERE company_id = companyId (proven at the repository-unit
    // level, kysely-catalog.repository.spec.ts) — here we assert the
    // controller/use-case pass company A's id, never company B's, and never
    // company B's items reach saveMany.
    const itemDeCompanyA = buildItem({ companyId: companyA, categoria: 'Bebidas' });
    actorPort.findActorById.mockResolvedValueOnce(
      buildProviderActor({ profileId, companyId: companyA }),
    );
    catalogRepository.findByCompanyAndCategoria.mockResolvedValueOnce([itemDeCompanyA]);
    const token = await signToken(profileId);

    await request(app.getHttpServer())
      .post('/catalogo/mi-catalogo/ajustes-de-precio')
      .set('Authorization', `Bearer ${token}`)
      .send({ categoria: 'Bebidas', porcentaje: 10 })
      .expect(204);

    expect(catalogRepository.findByCompanyAndCategoria).toHaveBeenCalledWith(
      companyA,
      'Bebidas',
      expect.anything(),
    );
    expect(catalogRepository.findByCompanyAndCategoria).not.toHaveBeenCalledWith(
      companyB,
      expect.anything(),
      expect.anything(),
    );
    const [savedItems] = catalogRepository.saveMany.mock.calls[0]!;
    expect(savedItems).toHaveLength(1);
    expect(savedItems.every((i) => i.companyId === companyA)).toBe(true);
  });

  it('rejects a missing categoria with 400 (DTO rejection)', async () => {
    const profileId = randomUUID();
    actorPort.findActorById.mockResolvedValueOnce(
      buildProviderActor({ profileId, companyId: randomUUID() }),
    );
    const token = await signToken(profileId);

    await request(app.getHttpServer())
      .post('/catalogo/mi-catalogo/ajustes-de-precio')
      .set('Authorization', `Bearer ${token}`)
      .send({ porcentaje: 10 })
      .expect(400);

    expect(catalogRepository.findByCompanyAndCategoria).not.toHaveBeenCalled();
  });

  it('rejects with 403 EMPRESA_NO_ACTIVA when the actor.companyStatus is suspendido, before any repository call', async () => {
    const profileId = randomUUID();
    actorPort.findActorById.mockResolvedValueOnce(
      buildProviderActor({ profileId, companyId: randomUUID(), companyStatus: 'suspendido' }),
    );
    const token = await signToken(profileId);

    const res = await request(app.getHttpServer())
      .post('/catalogo/mi-catalogo/ajustes-de-precio')
      .set('Authorization', `Bearer ${token}`)
      .send({ categoria: 'Bebidas', porcentaje: 10 })
      .expect(403);

    expect(res.body).toMatchObject({ statusCode: 403, code: 'EMPRESA_NO_ACTIVA' });
    expect(catalogRepository.findByCompanyAndCategoria).not.toHaveBeenCalled();
    expect(eventPublisher.publish).not.toHaveBeenCalled();
  });

  it('rejects a non-provider actor with 403 ROLE_NOT_ALLOWED', async () => {
    const profileId = randomUUID();
    actorPort.findActorById.mockResolvedValueOnce({
      profileId,
      role: 'user',
      status: 'activo',
      companyId: null,
      companyStatus: null,
      adminRole: null,
    });
    const token = await signToken(profileId);

    const res = await request(app.getHttpServer())
      .post('/catalogo/mi-catalogo/ajustes-de-precio')
      .set('Authorization', `Bearer ${token}`)
      .send({ categoria: 'Bebidas', porcentaje: 10 })
      .expect(403);

    expect(res.body).toMatchObject({ statusCode: 403, code: 'ROLE_NOT_ALLOWED' });
  });

  it('rejects an unauthenticated request with 401', () => {
    return request(app.getHttpServer())
      .post('/catalogo/mi-catalogo/ajustes-de-precio')
      .send({ categoria: 'Bebidas', porcentaje: 10 })
      .expect(401)
      .expect((res) => {
        expect(res.body).toMatchObject({ statusCode: 401, code: 'MISSING_BEARER_TOKEN' });
      });
  });
});
