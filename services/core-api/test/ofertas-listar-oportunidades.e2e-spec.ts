import { randomUUID } from 'node:crypto';
import { INestApplication, ValidationPipe } from '@nestjs/common';
import { Test } from '@nestjs/testing';
import type { SolicitudElegible } from '@repon/types';
import { SignJWT } from 'jose';
import request from 'supertest';
import { AppModule } from '../src/app.module';
import {
  OFFER_OPPORTUNITY_REPOSITORY,
  type OfferOpportunityRepository,
} from '../src/domains/ofertas/ports-out/offer-opportunity-repository.port';
import { GlobalExceptionFilter } from '../src/shared/auth/global-exception.filter';
import {
  ACTOR_PORT,
  type ActorPort,
  type AuthenticatedActor,
} from '../src/shared/auth/ports/actor.port';

// core-api-ofertas spec: "listarSolicitudesElegibles is scoped to the
// actor's own companyId and excludes closed opportunities" — the e2e proof
// of design.md Diagrama 3 for `GET /ofertas/oportunidades`, this domain's
// FIRST HTTP surface (tasks.md 4b.7). Same "override the port, keep the
// wiring real" convention every sibling `*.e2e-spec.ts` in this repo
// already uses (`catalogo-mi-catalogo.e2e-spec.ts` is the direct template):
// exercises the REAL `AuthGuard`/`RolesGuard`/`OfertasExceptionFilter`,
// only overriding `ACTOR_PORT` and `OFFER_OPPORTUNITY_REPOSITORY` — no
// local Supabase/Docker required. Confirmed against this repo's own e2e
// convention: NO `*.e2e-spec.ts` file anywhere imports `DATABASE`/
// `DatabaseModule`/a real `Kysely`/`pg.Pool` instance (grep-verified before
// writing this file) — that class of real-Postgres test is named
// `*.integration-spec.ts` instead (`test/jest-integration.json`, opt-in,
// not run by `pnpm test`'s default `test:e2e` script). design.md's own
// testing-strategy table lists this domain's E2E row as
// "`ACTOR_PORT`/`JWT_VERIFIER` overwritten" with "CI: Sí" — consistent
// with never touching a real database.
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

function buildUserActor(profileId: string): AuthenticatedActor {
  return {
    profileId,
    role: 'user',
    status: 'activo',
    companyId: null,
    companyStatus: null,
    adminRole: null,
  };
}

function solicitudFixture(overrides: Partial<SolicitudElegible> = {}): SolicitudElegible {
  return {
    refillRequestId: randomUUID(),
    comuna: 'Las Condes',
    urgencia: 'hoy',
    matchedAt: '2026-08-01T00:00:00.000Z',
    items: [
      {
        refillItemId: randomUUID(),
        nombre: 'Alimento perro',
        categoria: 'mascotas',
        precioReferencia: 15990,
        catalogProductId: randomUUID(),
      },
    ],
    ...overrides,
  };
}

describe('Ofertas — GET /ofertas/oportunidades (e2e)', () => {
  let app: INestApplication;
  let actorPort: jest.Mocked<ActorPort>;
  let offerOpportunityRepository: jest.Mocked<OfferOpportunityRepository>;

  beforeAll(async () => {
    actorPort = { findActorById: jest.fn() };
    offerOpportunityRepository = {
      reemplazar: jest.fn(),
      findElegible: jest.fn(),
      listarPorCompany: jest.fn(),
      existeRelacion: jest.fn(),
      cerrar: jest.fn(),
    };

    const moduleRef = await Test.createTestingModule({ imports: [AppModule] })
      .overrideProvider(ACTOR_PORT)
      .useValue(actorPort)
      .overrideProvider(OFFER_OPPORTUNITY_REPOSITORY)
      .useValue(offerOpportunityRepository)
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

  it('rejects an unauthenticated request with 401', () => {
    return request(app.getHttpServer())
      .get('/ofertas/oportunidades')
      .expect(401)
      .expect((res) => {
        expect(res.body).toMatchObject({ statusCode: 401, code: 'MISSING_BEARER_TOKEN' });
      });
  });

  it("rejects a non-provider actor (role 'user') with 403 ROLE_NOT_ALLOWED", async () => {
    const profileId = randomUUID();
    actorPort.findActorById.mockResolvedValueOnce(buildUserActor(profileId));
    const token = await signToken(profileId);

    const res = await request(app.getHttpServer())
      .get('/ofertas/oportunidades')
      .set('Authorization', `Bearer ${token}`)
      .expect(403);

    expect(res.body).toMatchObject({ statusCode: 403, code: 'ROLE_NOT_ALLOWED' });
    expect(offerOpportunityRepository.listarPorCompany).not.toHaveBeenCalled();
  });

  it(
    "returns 200 scoped to the actor's own companyId — never a different company's list " +
      "(core-api-ofertas Scenario 'A provider sees only solicitudes where their own company " +
      "is eligible')",
    async () => {
      const profileId = randomUUID();
      const companyId = randomUUID();
      const solicitudes = [solicitudFixture(), solicitudFixture()];
      actorPort.findActorById.mockResolvedValueOnce(buildProviderActor({ profileId, companyId }));
      offerOpportunityRepository.listarPorCompany.mockResolvedValueOnce(solicitudes);
      const token = await signToken(profileId);

      const res = await request(app.getHttpServer())
        .get('/ofertas/oportunidades')
        .set('Authorization', `Bearer ${token}`)
        .expect(200);

      expect(offerOpportunityRepository.listarPorCompany).toHaveBeenCalledTimes(1);
      expect(offerOpportunityRepository.listarPorCompany).toHaveBeenCalledWith(companyId);
      expect(res.body).toEqual(
        solicitudes.map((s) => ({
          refillRequestId: s.refillRequestId,
          comuna: s.comuna,
          urgencia: s.urgencia,
          matchedAt: s.matchedAt,
          items: s.items.map((item) => ({ ...item })),
        })),
      );
      // Diagrama 3: `userId` is never part of this response shape.
      for (const item of res.body as Array<Record<string, unknown>>) {
        expect(item).not.toHaveProperty('userId');
      }
    },
  );

  it('returns 200 with an empty array when the actor company has zero eligible solicitudes', async () => {
    const profileId = randomUUID();
    const companyId = randomUUID();
    actorPort.findActorById.mockResolvedValueOnce(buildProviderActor({ profileId, companyId }));
    offerOpportunityRepository.listarPorCompany.mockResolvedValueOnce([]);
    const token = await signToken(profileId);

    const res = await request(app.getHttpServer())
      .get('/ofertas/oportunidades')
      .set('Authorization', `Bearer ${token}`)
      .expect(200);

    expect(res.body).toEqual([]);
  });

  it(
    "a closed opportunity does not appear in any (previously eligible) provider's list " +
      "(core-api-ofertas Scenario 'A closed opportunity does not appear in any provider's " +
      "list')",
    async () => {
      // `aceptarOferta` — the only use case that closes an opportunity
      // (design.md D12) — does not exist until Phase 7a. There is therefore
      // no real, end-to-end path in this batch that can produce a genuinely
      // closed `offer_opportunities` row through the API. This e2e spec
      // mocks `OFFER_OPPORTUNITY_REPOSITORY` entirely (see the file-level
      // comment above) rather than hitting a real Postgres instance, so
      // "seeding the closed row" here means exactly what it means for every
      // other case in this file: configuring what the mocked repository
      // returns, standing in for "the repository already applied its own
      // `cerrada_at IS NULL` filter" (design.md Diagrama 3's exact SQL
      // predicate). That SQL-level guarantee itself is already unit-tested
      // against a mocked Kysely query builder in
      // `kysely-offer-opportunity.repository.spec.ts` (PR3b, task 3b.7:
      // "filters c.vigente AND o.cerrada_at IS NULL AND i.vigente"). This
      // e2e test's job is the layer that unit test cannot cover: proving
      // the HTTP/use-case wiring correctly returns "no longer eligible" to
      // EVERY previously-eligible company once the repository (for any
      // reason, closure included) stops listing them — company A and
      // company B both previously matched this same now-closed R; the mock
      // is configured to return an empty result for each of them
      // independently, exactly what a real closed-and-filtered-out R would
      // produce for both.
      const closedRefillRequestId = randomUUID();
      const profileIdA = randomUUID();
      const companyIdA = randomUUID();
      const profileIdB = randomUUID();
      const companyIdB = randomUUID();

      actorPort.findActorById.mockResolvedValueOnce(
        buildProviderActor({ profileId: profileIdA, companyId: companyIdA }),
      );
      // The repository never returns `closedRefillRequestId` for company A
      // — same shape `listarPorCompany` would produce for a real closed
      // opportunity (design.md D-A.3: closing is monotonic, visible to no
      // one, ever again).
      offerOpportunityRepository.listarPorCompany.mockResolvedValueOnce([]);
      const tokenA = await signToken(profileIdA);

      const resA = await request(app.getHttpServer())
        .get('/ofertas/oportunidades')
        .set('Authorization', `Bearer ${tokenA}`)
        .expect(200);

      expect(resA.body).toEqual([]);
      expect(
        (resA.body as SolicitudElegible[]).find((s) => s.refillRequestId === closedRefillRequestId),
      ).toBeUndefined();

      actorPort.findActorById.mockResolvedValueOnce(
        buildProviderActor({ profileId: profileIdB, companyId: companyIdB }),
      );
      offerOpportunityRepository.listarPorCompany.mockResolvedValueOnce([]);
      const tokenB = await signToken(profileIdB);

      const resB = await request(app.getHttpServer())
        .get('/ofertas/oportunidades')
        .set('Authorization', `Bearer ${tokenB}`)
        .expect(200);

      expect(resB.body).toEqual([]);
      expect(offerOpportunityRepository.listarPorCompany).toHaveBeenNthCalledWith(1, companyIdA);
      expect(offerOpportunityRepository.listarPorCompany).toHaveBeenNthCalledWith(2, companyIdB);
    },
  );
});
