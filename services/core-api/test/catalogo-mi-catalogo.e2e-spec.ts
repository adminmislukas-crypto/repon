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
import { EVENT_PUBLISHER, type EventPublisher } from '../src/shared/event-bus/event-publisher.port';

// core-api-catalogo spec: this is the end-to-end proof of R1 (design.md
// Diagram 3) — "Cross-tenant update attempt returns 404, not 403, and does
// not mutate" — plus "A client-supplied companyId cannot influence the
// write" (the DTO has no `companyId` field at all, task 4b.6). Same
// "override the port, keep the wiring real" approach as
// `identidad.e2e-spec.ts`/`catalogo-buscar-productos.e2e-spec.ts`:
// exercises the REAL `AuthGuard`/`RolesGuard`/`ValidationPipe`/
// `CatalogoExceptionFilter`, only overriding `ACTOR_PORT`,
// `CATALOG_REPOSITORY`, and `EVENT_PUBLISHER` (no local Supabase required).
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

describe('Catalogo — POST/PUT /catalogo/mi-catalogo (e2e)', () => {
  let app: INestApplication;
  let actorPort: jest.Mocked<ActorPort>;
  let catalogRepository: jest.Mocked<CatalogRepository>;
  let eventPublisher: jest.Mocked<EventPublisher>;

  beforeAll(async () => {
    actorPort = { findActorById: jest.fn() };
    catalogRepository = {
      save: jest.fn().mockResolvedValue(undefined),
      saveMany: jest.fn(),
      findById: jest.fn(),
      findByCompany: jest.fn(),
      findByCompanyAndCategoria: jest.fn(),
      findMatching: jest.fn(),
    };
    eventPublisher = { publish: jest.fn().mockResolvedValue(undefined) };

    const moduleRef = await Test.createTestingModule({ imports: [AppModule] })
      .overrideProvider(ACTOR_PORT)
      .useValue(actorPort)
      .overrideProvider(CATALOG_REPOSITORY)
      .useValue(catalogRepository)
      .overrideProvider(EVENT_PUBLISHER)
      .useValue(eventPublisher)
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

  const validNuevoProducto = {
    nombre: 'Agua Purificada 5L',
    categoria: 'Bebidas',
    precioBase: 1000,
    precioMaximo: 1500,
    stock: 10,
  };

  describe("POST /catalogo/mi-catalogo (@Roles('provider'))", () => {
    it('creates the item scoped to the actor.companyId and publishes ProductoAgregado — happy path (201)', async () => {
      const profileId = randomUUID();
      const companyId = randomUUID();
      actorPort.findActorById.mockResolvedValueOnce(buildProviderActor({ profileId, companyId }));
      const token = await signToken(profileId);

      const res = await request(app.getHttpServer())
        .post('/catalogo/mi-catalogo')
        .set('Authorization', `Bearer ${token}`)
        .send(validNuevoProducto)
        .expect(201);

      expect(res.body).toMatchObject({ companyId, ...validNuevoProducto });
      expect(catalogRepository.save).toHaveBeenCalledWith(expect.objectContaining({ companyId }));
      expect(eventPublisher.publish).toHaveBeenCalledWith(
        expect.objectContaining({ type: 'producto.agregado', companyId }),
      );
    });

    it('rejects a client-supplied companyId with 400 (D8: the DTO has no such field)', async () => {
      const profileId = randomUUID();
      actorPort.findActorById.mockResolvedValueOnce(
        buildProviderActor({ profileId, companyId: randomUUID() }),
      );
      const token = await signToken(profileId);

      const res = await request(app.getHttpServer())
        .post('/catalogo/mi-catalogo')
        .set('Authorization', `Bearer ${token}`)
        .send({ ...validNuevoProducto, companyId: randomUUID() })
        .expect(400);

      expect(res.body).toMatchObject({ statusCode: 400 });
      expect(catalogRepository.save).not.toHaveBeenCalled();
    });

    it('rejects a missing required field with 400', async () => {
      const profileId = randomUUID();
      actorPort.findActorById.mockResolvedValueOnce(
        buildProviderActor({ profileId, companyId: randomUUID() }),
      );
      const token = await signToken(profileId);
      const { nombre: _nombre, ...withoutNombre } = validNuevoProducto;

      await request(app.getHttpServer())
        .post('/catalogo/mi-catalogo')
        .set('Authorization', `Bearer ${token}`)
        .send(withoutNombre)
        .expect(400);

      expect(catalogRepository.save).not.toHaveBeenCalled();
    });

    it('rejects with 403 EMPRESA_NO_ACTIVA when the actor.companyStatus is suspendido', async () => {
      const profileId = randomUUID();
      actorPort.findActorById.mockResolvedValueOnce(
        buildProviderActor({ profileId, companyId: randomUUID(), companyStatus: 'suspendido' }),
      );
      const token = await signToken(profileId);

      const res = await request(app.getHttpServer())
        .post('/catalogo/mi-catalogo')
        .set('Authorization', `Bearer ${token}`)
        .send(validNuevoProducto)
        .expect(403);

      expect(res.body).toMatchObject({ statusCode: 403, code: 'EMPRESA_NO_ACTIVA' });
      expect(catalogRepository.save).not.toHaveBeenCalled();
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
        .post('/catalogo/mi-catalogo')
        .set('Authorization', `Bearer ${token}`)
        .send(validNuevoProducto)
        .expect(403);

      expect(res.body).toMatchObject({ statusCode: 403, code: 'ROLE_NOT_ALLOWED' });
    });
  });

  describe("PUT /catalogo/mi-catalogo/:itemId/precio (@Roles('provider'))", () => {
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

    it("updates the item's price and publishes PrecioActualizado when the actor owns it — happy path (204)", async () => {
      const profileId = randomUUID();
      const companyId = randomUUID();
      const item = buildItem({ companyId });
      actorPort.findActorById.mockResolvedValueOnce(buildProviderActor({ profileId, companyId }));
      catalogRepository.findById.mockResolvedValueOnce(item);
      const token = await signToken(profileId);

      await request(app.getHttpServer())
        .put(`/catalogo/mi-catalogo/${item.id}/precio`)
        .set('Authorization', `Bearer ${token}`)
        .send({ precioBase: 200, precioMaximo: 300 })
        .expect(204);

      expect(catalogRepository.save).toHaveBeenCalledWith(
        expect.objectContaining({ id: item.id, precioBase: 200, precioMaximo: 300 }),
      );
      expect(eventPublisher.publish).toHaveBeenCalledWith(
        expect.objectContaining({ type: 'catalogo.precio_actualizado', companyId }),
      );
    });

    it('returns 404 CATALOG_ITEM_NOT_FOUND — never 403 — for a cross-tenant item, and does not mutate (R1)', async () => {
      const profileId = randomUUID();
      const actorCompanyId = randomUUID();
      const ownerCompanyId = randomUUID();
      const item = buildItem({ companyId: ownerCompanyId });
      actorPort.findActorById.mockResolvedValueOnce(
        buildProviderActor({ profileId, companyId: actorCompanyId }),
      );
      catalogRepository.findById.mockResolvedValueOnce(item);
      const token = await signToken(profileId);

      const res = await request(app.getHttpServer())
        .put(`/catalogo/mi-catalogo/${item.id}/precio`)
        .set('Authorization', `Bearer ${token}`)
        .send({ precioBase: 200, precioMaximo: 300 })
        .expect(404);

      expect(res.body).toMatchObject({ statusCode: 404, code: 'CATALOG_ITEM_NOT_FOUND' });
      expect(catalogRepository.save).not.toHaveBeenCalled();
      expect(eventPublisher.publish).not.toHaveBeenCalled();
    });

    it('returns 404 CATALOG_ITEM_NOT_FOUND for a genuinely missing item — byte-identical to the cross-tenant case', async () => {
      const profileId = randomUUID();
      actorPort.findActorById.mockResolvedValueOnce(
        buildProviderActor({ profileId, companyId: randomUUID() }),
      );
      catalogRepository.findById.mockResolvedValueOnce(null);
      const token = await signToken(profileId);

      const res = await request(app.getHttpServer())
        .put(`/catalogo/mi-catalogo/${randomUUID()}/precio`)
        .set('Authorization', `Bearer ${token}`)
        .send({ precioBase: 200, precioMaximo: 300 })
        .expect(404);

      expect(res.body).toMatchObject({ statusCode: 404, code: 'CATALOG_ITEM_NOT_FOUND' });
    });

    it('rejects a body missing precioMaximo with 400 (DTO rejection)', async () => {
      const profileId = randomUUID();
      actorPort.findActorById.mockResolvedValueOnce(
        buildProviderActor({ profileId, companyId: randomUUID() }),
      );
      const token = await signToken(profileId);

      await request(app.getHttpServer())
        .put(`/catalogo/mi-catalogo/${randomUUID()}/precio`)
        .set('Authorization', `Bearer ${token}`)
        .send({ precioBase: 200 })
        .expect(400);

      expect(catalogRepository.findById).not.toHaveBeenCalled();
    });

    it('rejects an unknown extra field with 400 (forbidNonWhitelisted)', async () => {
      const profileId = randomUUID();
      actorPort.findActorById.mockResolvedValueOnce(
        buildProviderActor({ profileId, companyId: randomUUID() }),
      );
      const token = await signToken(profileId);

      await request(app.getHttpServer())
        .put(`/catalogo/mi-catalogo/${randomUUID()}/precio`)
        .set('Authorization', `Bearer ${token}`)
        .send({ precioBase: 200, precioMaximo: 300, companyId: randomUUID() })
        .expect(400);
    });

    it('rejects with 403 EMPRESA_NO_ACTIVA when the actor.companyStatus is pendiente, before any repository call', async () => {
      const profileId = randomUUID();
      actorPort.findActorById.mockResolvedValueOnce(
        buildProviderActor({ profileId, companyId: randomUUID(), companyStatus: 'pendiente' }),
      );
      const token = await signToken(profileId);

      const res = await request(app.getHttpServer())
        .put(`/catalogo/mi-catalogo/${randomUUID()}/precio`)
        .set('Authorization', `Bearer ${token}`)
        .send({ precioBase: 200, precioMaximo: 300 })
        .expect(403);

      expect(res.body).toMatchObject({ statusCode: 403, code: 'EMPRESA_NO_ACTIVA' });
      expect(catalogRepository.findById).not.toHaveBeenCalled();
    });

    it('rejects an unauthenticated request with 401', () => {
      return request(app.getHttpServer())
        .put(`/catalogo/mi-catalogo/${randomUUID()}/precio`)
        .send({ precioBase: 200, precioMaximo: 300 })
        .expect(401)
        .expect((res) => {
          expect(res.body).toMatchObject({ statusCode: 401, code: 'MISSING_BEARER_TOKEN' });
        });
    });
  });
});
