import { randomUUID } from 'node:crypto';
import { INestApplication, ValidationPipe } from '@nestjs/common';
import { Test } from '@nestjs/testing';
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

// core-api-catalogo spec: "cargarCatalogoMasivo processes rows
// independently and reports partial failure" + "Two rows identifying the
// same product within one file are rejected as a duplicate" + "The 4
// mutating use cases require an active company", end-to-end over the real
// HTTP pipeline (design.md Diagram 1). Same "override the port, keep the
// wiring real" approach as `catalogo-mi-catalogo.e2e-spec.ts`: exercises
// the REAL `AuthGuard`/`RolesGuard`/`FileInterceptor`/`ValidationPipe`/
// `CatalogoExceptionFilter`, only overriding `ACTOR_PORT`,
// `CATALOG_REPOSITORY`, and `EVENT_PUBLISHER`.
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

const REQUIRED_HEADER =
  'catalogProductId,nombre,categoria,precioBase,precioMaximo,stock,disponible,imagenUrl';

function filaCsv(overrides: Partial<Record<string, string>> = {}): string {
  const columnas: Record<string, string> = {
    catalogProductId: '',
    nombre: 'Producto',
    categoria: 'Categoria',
    precioBase: '1000',
    precioMaximo: '1500',
    stock: '10',
    disponible: 'true',
    imagenUrl: '',
    ...overrides,
  };
  return [
    columnas.catalogProductId,
    columnas.nombre,
    columnas.categoria,
    columnas.precioBase,
    columnas.precioMaximo,
    columnas.stock,
    columnas.disponible,
    columnas.imagenUrl,
  ].join(',');
}

function csvBuffer(filas: string[]): Buffer {
  return Buffer.from([REQUIRED_HEADER, ...filas].join('\n'), 'utf-8');
}

describe('Catalogo — POST /catalogo/mi-catalogo/carga-masiva (e2e)', () => {
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

  async function authenticate(overrides: Partial<AuthenticatedActor> = {}): Promise<{
    token: string;
    companyId: string;
  }> {
    const profileId = randomUUID();
    const companyId = overrides.companyId ?? randomUUID();
    actorPort.findActorById.mockResolvedValueOnce(
      buildProviderActor({ ...overrides, profileId, companyId }),
    );
    const token = await signToken(profileId);
    return { token, companyId };
  }

  it('reports partial failure per row (mixed valid/invalid rows) and persists only the valid ones — 200', async () => {
    const { token, companyId } = await authenticate();
    const archivo = csvBuffer([
      filaCsv({ nombre: 'Agua Purificada 5L' }),
      filaCsv({ nombre: '' }), // invalid: empty nombre -> ProductoInvalidoError
      filaCsv({ nombre: 'Jabón Líquido' }),
    ]);

    const res = await request(app.getHttpServer())
      .post('/catalogo/mi-catalogo/carga-masiva')
      .set('Authorization', `Bearer ${token}`)
      .attach('archivo', archivo, { filename: 'catalogo.csv', contentType: 'text/csv' })
      .expect(200);

    expect(res.body).toMatchObject({
      totalFilas: 3,
      totalCargados: 2,
      totalFallidos: 1,
      fallos: [{ numero: 2, motivo: expect.any(String) }],
    });
    expect(catalogRepository.save).toHaveBeenCalledTimes(2);
    expect(catalogRepository.save).toHaveBeenCalledWith(expect.objectContaining({ companyId }));
    expect(eventPublisher.publish).toHaveBeenCalledTimes(1);
    expect(eventPublisher.publish).toHaveBeenCalledWith(
      expect.objectContaining({
        type: 'catalogo.carga_masiva_completada',
        companyId,
        totalCargados: 2,
        totalFallidos: 1,
      }),
    );
  });

  it('rejects the 2nd row sharing the same product identity within the file as a duplicate, not a merge — 200 with a fallos entry', async () => {
    const { token } = await authenticate();
    const archivo = csvBuffer([
      filaCsv({ nombre: 'Agua Purificada', categoria: 'Bebidas' }),
      filaCsv({ nombre: 'Agua Purificada', categoria: 'Bebidas', precioBase: '2000' }),
    ]);

    const res = await request(app.getHttpServer())
      .post('/catalogo/mi-catalogo/carga-masiva')
      .set('Authorization', `Bearer ${token}`)
      .attach('archivo', archivo, { filename: 'catalogo.csv', contentType: 'text/csv' })
      .expect(200);

    expect(res.body).toMatchObject({
      totalFilas: 2,
      totalCargados: 1,
      totalFallidos: 1,
      fallos: [{ numero: 2, motivo: expect.any(String) }],
    });
    expect(catalogRepository.save).toHaveBeenCalledTimes(1);
  });

  it('rejects a malformed file (missing required header columns) with 400 ARCHIVO_CARGA_INVALIDO — before the use case runs', async () => {
    const { token } = await authenticate();
    const archivoSinCabeceraValida = Buffer.from('nombre,categoria\nAgua,Bebidas', 'utf-8');

    const res = await request(app.getHttpServer())
      .post('/catalogo/mi-catalogo/carga-masiva')
      .set('Authorization', `Bearer ${token}`)
      .attach('archivo', archivoSinCabeceraValida, {
        filename: 'catalogo.csv',
        contentType: 'text/csv',
      })
      .expect(400);

    expect(res.body).toMatchObject({ statusCode: 400, code: 'ARCHIVO_CARGA_INVALIDO' });
    expect(catalogRepository.save).not.toHaveBeenCalled();
    expect(eventPublisher.publish).not.toHaveBeenCalled();
  });

  it('rejects a file with the wrong mimetype with 400 ARCHIVO_CARGA_INVALIDO', async () => {
    const { token } = await authenticate();
    const archivo = csvBuffer([filaCsv()]);

    const res = await request(app.getHttpServer())
      .post('/catalogo/mi-catalogo/carga-masiva')
      .set('Authorization', `Bearer ${token}`)
      .attach('archivo', archivo, {
        filename: 'catalogo.xlsx',
        contentType: 'application/vnd.ms-excel',
      })
      .expect(400);

    expect(res.body).toMatchObject({ statusCode: 400, code: 'ARCHIVO_CARGA_INVALIDO' });
    expect(catalogRepository.save).not.toHaveBeenCalled();
  });

  it('rejects with 403 EMPRESA_NO_ACTIVA when the actor.companyStatus is suspendido — before any row is processed', async () => {
    const { token } = await authenticate({ companyStatus: 'suspendido' });
    const archivo = csvBuffer([filaCsv()]);

    const res = await request(app.getHttpServer())
      .post('/catalogo/mi-catalogo/carga-masiva')
      .set('Authorization', `Bearer ${token}`)
      .attach('archivo', archivo, { filename: 'catalogo.csv', contentType: 'text/csv' })
      .expect(403);

    expect(res.body).toMatchObject({ statusCode: 403, code: 'EMPRESA_NO_ACTIVA' });
    expect(catalogRepository.save).not.toHaveBeenCalled();
    expect(eventPublisher.publish).not.toHaveBeenCalled();
  });

  it('publishes exactly one CatalogoCargaMasivaCompletada even when every row fails (totalCargados = 0)', async () => {
    const { token, companyId } = await authenticate();
    const archivo = csvBuffer([filaCsv({ nombre: '' }), filaCsv({ stock: '-1' })]);

    const res = await request(app.getHttpServer())
      .post('/catalogo/mi-catalogo/carga-masiva')
      .set('Authorization', `Bearer ${token}`)
      .attach('archivo', archivo, { filename: 'catalogo.csv', contentType: 'text/csv' })
      .expect(200);

    expect(res.body).toMatchObject({ totalCargados: 0, totalFallidos: 2 });
    expect(catalogRepository.save).not.toHaveBeenCalled();
    expect(eventPublisher.publish).toHaveBeenCalledTimes(1);
    expect(eventPublisher.publish).toHaveBeenCalledWith(
      expect.objectContaining({ companyId, totalCargados: 0, totalFallidos: 2 }),
    );
  });

  it('rejects a non-provider actor with 403 ROLE_NOT_ALLOWED, before the interceptor ever parses a file', async () => {
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
    const archivo = csvBuffer([filaCsv()]);

    const res = await request(app.getHttpServer())
      .post('/catalogo/mi-catalogo/carga-masiva')
      .set('Authorization', `Bearer ${token}`)
      .attach('archivo', archivo, { filename: 'catalogo.csv', contentType: 'text/csv' })
      .expect(403);

    expect(res.body).toMatchObject({ statusCode: 403, code: 'ROLE_NOT_ALLOWED' });
    expect(catalogRepository.save).not.toHaveBeenCalled();
  });
});
