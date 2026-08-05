import { INestApplication, ValidationPipe } from '@nestjs/common';
import { Test } from '@nestjs/testing';
import type { CatalogProduct } from '@repon/types';
import { SignJWT } from 'jose';
import request from 'supertest';
import { AppModule } from '../src/app.module';
import {
  CATALOG_PRODUCT_REPOSITORY,
  type CatalogProductRepository,
} from '../src/domains/catalogo/ports-out/catalog-product-repository.port';
import { GlobalExceptionFilter } from '../src/shared/auth/global-exception.filter';
import {
  ACTOR_PORT,
  type ActorPort,
  type AuthenticatedActor,
} from '../src/shared/auth/ports/actor.port';

// core-api-catalogo spec, "buscarProductos reads the shared reference
// catalog, with no company dimension" — happy path — plus
// core-api-auth-guard's fail-closed-by-default guarantee for a
// non-`@Public()` route (tasks.md 3b.9). Same "override the port, keep the
// wiring real" approach as `identidad.e2e-spec.ts`: exercises the REAL
// `AuthGuard`/`RolesGuard`/`ValidationPipe`, only overriding `ACTOR_PORT`
// (so no local Supabase is required) and `CATALOG_PRODUCT_REPOSITORY`.
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

describe('Catalogo — GET /catalogo/productos (e2e)', () => {
  let app: INestApplication;
  let actorPort: jest.Mocked<ActorPort>;
  let catalogProductRepository: jest.Mocked<CatalogProductRepository>;

  beforeAll(async () => {
    actorPort = { findActorById: jest.fn() };
    catalogProductRepository = { buscar: jest.fn() };

    const moduleRef = await Test.createTestingModule({ imports: [AppModule] })
      .overrideProvider(ACTOR_PORT)
      .useValue(actorPort)
      .overrideProvider(CATALOG_PRODUCT_REPOSITORY)
      .useValue(catalogProductRepository)
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

  it('200s with the mapped CatalogProduct[] for any authenticated actor — no @Roles gate', async () => {
    const actor: AuthenticatedActor = {
      profileId: '11111111-1111-1111-1111-111111111111',
      role: 'user',
      status: 'activo',
      companyId: null,
      companyStatus: null,
      adminRole: null,
    };
    actorPort.findActorById.mockResolvedValueOnce(actor);
    const product: CatalogProduct = {
      id: '22222222-2222-2222-2222-222222222222',
      nombre: 'Detergente Ropa',
      categoria: 'Limpieza',
      status: 'activo',
    };
    catalogProductRepository.buscar.mockResolvedValueOnce([product]);
    const token = await signToken(actor.profileId);

    const res = await request(app.getHttpServer())
      .get('/catalogo/productos')
      .query({ q: 'detergente' })
      .set('Authorization', `Bearer ${token}`)
      .expect(200);

    expect(res.body).toEqual([product]);
    expect(catalogProductRepository.buscar).toHaveBeenCalledWith('detergente', undefined);
  });

  it('rejects with 401 when no Authorization header is present', () => {
    return request(app.getHttpServer())
      .get('/catalogo/productos')
      .query({ q: 'detergente' })
      .expect(401)
      .expect((res) => {
        expect(res.body).toMatchObject({ statusCode: 401, code: 'MISSING_BEARER_TOKEN' });
      });
  });
});
