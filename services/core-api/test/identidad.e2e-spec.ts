import { randomUUID } from 'node:crypto';
import { INestApplication, ValidationPipe } from '@nestjs/common';
import { Test } from '@nestjs/testing';
import type { Company, Profile } from '@repon/types';
import { SignJWT } from 'jose';
import request from 'supertest';
import { AppModule } from '../src/app.module';
import {
  ADMIN_ROLE_REPOSITORY,
  type AdminRoleRepository,
} from '../src/domains/identidad/ports-out/admin-role-repository.port';
import {
  AUTH_PROVIDER,
  type AuthProvider,
} from '../src/domains/identidad/ports-out/auth-provider.port';
import {
  COMPANY_REPOSITORY,
  type CompanyRepository,
} from '../src/domains/identidad/ports-out/company-repository.port';
import {
  PROFILE_REPOSITORY,
  type ProfileRepository,
} from '../src/domains/identidad/ports-out/profile-repository.port';
import { AuthProviderDeterministicError } from '../src/domains/identidad/ports-out/auth-provider.port';
import { AUDIT_LOG_PORT, type AuditLogPort } from '../src/shared/audit/audit-log.port';
import {
  TRANSACTION_MANAGER,
  type TransactionContext,
  type TransactionManager,
} from '../src/shared/database/transaction';
import { EVENT_PUBLISHER, type EventPublisher } from '../src/shared/event-bus/event-publisher.port';
import {
  ACTOR_PORT,
  type ActorPort,
  type AuthenticatedActor,
} from '../src/shared/auth/ports/actor.port';
import { GlobalExceptionFilter } from '../src/shared/auth/global-exception.filter';

// `core-api-auth-guard` spec, "Controller passes scalars...": this e2e
// suite is the layer where guard+role enforcement is provable end-to-end
// (tasks.md 4c.6) — it exercises the REAL `AppModule` (real `AuthGuard`,
// `RolesGuard`, `IdentidadExceptionFilter`, `ValidationPipe`), only
// overriding the 6 identidad ports-out + `ACTOR_PORT` so no local Supabase
// is required (same "override the port, keep the wiring real" idea as
// `auth-guard-activation.e2e-spec.ts`, one level deeper).
//
// Same HS256 secret/issuer/audience as test/env.e2e-setup.ts, so a token
// signed here verifies through the real `Hs256JwtVerifier`.
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

function buildActor(
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

describe('Identidad HTTP adapter (e2e)', () => {
  let app: INestApplication;
  let actorPort: jest.Mocked<ActorPort>;
  let companyRepository: jest.Mocked<CompanyRepository>;
  let profileRepository: jest.Mocked<ProfileRepository>;
  let adminRoleRepository: jest.Mocked<AdminRoleRepository>;
  let authProvider: jest.Mocked<AuthProvider>;
  let auditLogPort: jest.Mocked<AuditLogPort>;
  let eventPublisher: jest.Mocked<EventPublisher>;

  beforeAll(async () => {
    actorPort = { findActorById: jest.fn() };
    companyRepository = { save: jest.fn(), findById: jest.fn() };
    profileRepository = { insertIfAbsent: jest.fn(), update: jest.fn(), findById: jest.fn() };
    adminRoleRepository = { upsert: jest.fn(), findByProfileId: jest.fn() };
    authProvider = {
      createAccount: jest.fn(),
      deleteAccount: jest.fn(),
      findAccountByEmail: jest.fn(),
    };
    auditLogPort = { record: jest.fn().mockResolvedValue(undefined) };
    eventPublisher = { publish: jest.fn().mockResolvedValue(undefined) };
    const fakeTx = {} as TransactionContext;
    const transactionManager: jest.Mocked<TransactionManager> = {
      runInTransaction: jest.fn().mockImplementation((work) => work(fakeTx)),
    };

    const moduleRef = await Test.createTestingModule({ imports: [AppModule] })
      .overrideProvider(ACTOR_PORT)
      .useValue(actorPort)
      .overrideProvider(COMPANY_REPOSITORY)
      .useValue(companyRepository)
      .overrideProvider(PROFILE_REPOSITORY)
      .useValue(profileRepository)
      .overrideProvider(ADMIN_ROLE_REPOSITORY)
      .useValue(adminRoleRepository)
      .overrideProvider(AUTH_PROVIDER)
      .useValue(authProvider)
      .overrideProvider(AUDIT_LOG_PORT)
      .useValue(auditLogPort)
      .overrideProvider(EVENT_PUBLISHER)
      .useValue(eventPublisher)
      .overrideProvider(TRANSACTION_MANAGER)
      .useValue(transactionManager)
      .compile();

    app = moduleRef.createNestApplication();
    // Mirrors main.ts's real bootstrap wiring — this test builds AppModule
    // directly, so nothing else applies these.
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

  describe('POST /identidad/usuarios (@Public)', () => {
    const validBody = {
      email: 'ana@proveedora.cl',
      password: 'super-secret-1',
      nombre: 'Ana Pérez',
      role: 'user',
    };

    it('creates a profile with no Authorization header (public route works unauthenticated)', async () => {
      const uid = randomUUID();
      authProvider.createAccount.mockResolvedValueOnce(uid);
      profileRepository.insertIfAbsent.mockResolvedValueOnce(undefined);

      const res = await request(app.getHttpServer())
        .post('/identidad/usuarios')
        .send(validBody)
        .expect(201);

      expect(res.body).toMatchObject({
        id: uid,
        role: 'user',
        status: 'activo',
        nombre: 'Ana Pérez',
      });
      expect(eventPublisher.publish).toHaveBeenCalledWith(
        expect.objectContaining({ type: 'usuario.registrado' }),
      );
    });

    it('rejects an unknown extra field with 400 (forbidNonWhitelisted)', () => {
      return request(app.getHttpServer())
        .post('/identidad/usuarios')
        .send({ ...validBody, isAdmin: true })
        .expect(400);
    });

    it("rejects role: 'admin' at the DTO layer with 400 (self-service cannot grant admin)", () => {
      return request(app.getHttpServer())
        .post('/identidad/usuarios')
        .send({ ...validBody, role: 'admin' })
        .expect(400);
    });

    it('maps a deterministic email_taken Auth failure to 409 EMAIL_YA_REGISTRADO', async () => {
      authProvider.createAccount.mockRejectedValueOnce(
        new AuthProviderDeterministicError('email_taken'),
      );

      const res = await request(app.getHttpServer())
        .post('/identidad/usuarios')
        .send(validBody)
        .expect(409);

      expect(res.body).toMatchObject({ statusCode: 409, code: 'EMAIL_YA_REGISTRADO' });
    });
  });

  describe('POST /identidad/empresas (@Public)', () => {
    const validBody = {
      razonSocial: 'Proveedora SPA',
      rut: '76.123.456-7',
      giro: 'Distribución de agua',
    };

    it('creates a company with no Authorization header (public route works unauthenticated)', async () => {
      companyRepository.save.mockResolvedValueOnce(undefined);

      const res = await request(app.getHttpServer())
        .post('/identidad/empresas')
        .send(validBody)
        .expect(201);

      expect(res.body).toMatchObject({ ...validBody, status: 'pendiente' });
      expect(eventPublisher.publish).toHaveBeenCalledWith(
        expect.objectContaining({ type: 'empresa.registrada' }),
      );
    });

    it('rejects a missing required field with 400', () => {
      const { rut: _rut, ...withoutRut } = validBody;
      return request(app.getHttpServer()).post('/identidad/empresas').send(withoutRut).expect(400);
    });
  });

  describe('POST /identidad/empresas/:id/aprobacion (@AdminRoles(super_admin, soporte))', () => {
    const companyId = randomUUID();

    it('rejects a request with no Authorization header (authenticated route rejects without a token)', async () => {
      const res = await request(app.getHttpServer())
        .post(`/identidad/empresas/${companyId}/aprobacion`)
        .expect(401);

      expect(res.body).toMatchObject({ statusCode: 401, code: 'MISSING_BEARER_TOKEN' });
    });

    it('rejects a non-admin actor with 403 ROLE_NOT_ALLOWED (admin route rejects a non-admin actor)', async () => {
      const profileId = randomUUID();
      actorPort.findActorById.mockResolvedValueOnce(buildActor({ profileId, role: 'user' }));
      const token = await signToken(profileId);

      const res = await request(app.getHttpServer())
        .post(`/identidad/empresas/${companyId}/aprobacion`)
        .set('Authorization', `Bearer ${token}`)
        .expect(403);

      expect(res.body).toMatchObject({ statusCode: 403, code: 'ROLE_NOT_ALLOWED' });
    });

    it('approves the company for an allowed admin sub-role (soporte) — happy path', async () => {
      const profileId = randomUUID();
      actorPort.findActorById.mockResolvedValueOnce(
        buildActor({ profileId, role: 'admin', adminRole: 'soporte' }),
      );
      const token = await signToken(profileId);
      const company: Company = {
        id: companyId,
        razonSocial: 'X',
        rut: 'Y',
        giro: 'Z',
        status: 'pendiente',
      };
      companyRepository.findById.mockResolvedValueOnce(company);
      companyRepository.save.mockResolvedValueOnce(undefined);

      await request(app.getHttpServer())
        .post(`/identidad/empresas/${companyId}/aprobacion`)
        .set('Authorization', `Bearer ${token}`)
        .expect(204);

      expect(auditLogPort.record).toHaveBeenCalledWith(
        expect.objectContaining({ accion: 'aprobar_empresa' }),
        expect.anything(),
      );
      expect(eventPublisher.publish).toHaveBeenCalledWith(
        expect.objectContaining({ type: 'empresa.aprobada' }),
      );
    });

    it('maps a missing company to 404 COMPANY_NOT_FOUND', async () => {
      const profileId = randomUUID();
      actorPort.findActorById.mockResolvedValueOnce(
        buildActor({ profileId, role: 'admin', adminRole: 'super_admin' }),
      );
      const token = await signToken(profileId);
      companyRepository.findById.mockResolvedValueOnce(null);

      const res = await request(app.getHttpServer())
        .post(`/identidad/empresas/${companyId}/aprobacion`)
        .set('Authorization', `Bearer ${token}`)
        .expect(404);

      expect(res.body).toMatchObject({ statusCode: 404, code: 'COMPANY_NOT_FOUND' });
    });
  });

  describe('POST /identidad/empresas/:id/suspension (@AdminRoles(super_admin, soporte))', () => {
    it('rejects an admin actor with no sub-role assigned with 403 ADMIN_SUBROLE_MISSING', async () => {
      const profileId = randomUUID();
      actorPort.findActorById.mockResolvedValueOnce(
        buildActor({ profileId, role: 'admin', adminRole: null }),
      );
      const token = await signToken(profileId);

      const res = await request(app.getHttpServer())
        .post(`/identidad/empresas/${randomUUID()}/suspension`)
        .set('Authorization', `Bearer ${token}`)
        .send({ motivo: 'Incumplimiento' })
        .expect(403);

      expect(res.body).toMatchObject({ statusCode: 403, code: 'ADMIN_SUBROLE_MISSING' });
    });
  });

  describe('POST /identidad/usuarios/:id/suspension (@AdminRoles(super_admin, soporte))', () => {
    it('suspends the profile for an allowed admin sub-role — happy path', async () => {
      const adminId = randomUUID();
      const targetId = randomUUID();
      actorPort.findActorById.mockResolvedValueOnce(
        buildActor({ profileId: adminId, role: 'admin', adminRole: 'super_admin' }),
      );
      const token = await signToken(adminId);
      const profile: Profile = {
        id: targetId,
        role: 'user',
        status: 'activo',
        nombre: 'X',
        email: 'x@y.cl',
      };
      profileRepository.findById.mockResolvedValueOnce(profile);
      profileRepository.update.mockResolvedValueOnce(undefined);

      await request(app.getHttpServer())
        .post(`/identidad/usuarios/${targetId}/suspension`)
        .set('Authorization', `Bearer ${token}`)
        .send({ motivo: 'Incumplimiento' })
        .expect(204);

      expect(eventPublisher.publish).toHaveBeenCalledWith(
        expect.objectContaining({ type: 'usuario.suspendido' }),
      );
    });
  });

  describe('PUT /identidad/usuarios/:id/rol-admin (@AdminRoles(super_admin))', () => {
    it("rejects adminRole 'soporte' with 403 ADMIN_SUBROLE_NOT_ALLOWED (core-api-identidad spec scenario)", async () => {
      const adminId = randomUUID();
      actorPort.findActorById.mockResolvedValueOnce(
        buildActor({ profileId: adminId, role: 'admin', adminRole: 'soporte' }),
      );
      const token = await signToken(adminId);

      const res = await request(app.getHttpServer())
        .put(`/identidad/usuarios/${randomUUID()}/rol-admin`)
        .set('Authorization', `Bearer ${token}`)
        .send({ rol: 'soporte' })
        .expect(403);

      expect(res.body).toMatchObject({ statusCode: 403, code: 'ADMIN_SUBROLE_NOT_ALLOWED' });
    });

    it('assigns the sub-role for adminRole super_admin — happy path', async () => {
      const adminId = randomUUID();
      const targetId = randomUUID();
      actorPort.findActorById.mockResolvedValueOnce(
        buildActor({ profileId: adminId, role: 'admin', adminRole: 'super_admin' }),
      );
      const token = await signToken(adminId);
      adminRoleRepository.findByProfileId.mockResolvedValueOnce(null);
      adminRoleRepository.upsert.mockResolvedValueOnce(undefined);

      await request(app.getHttpServer())
        .put(`/identidad/usuarios/${targetId}/rol-admin`)
        .set('Authorization', `Bearer ${token}`)
        .send({ rol: 'soporte' })
        .expect(204);

      expect(adminRoleRepository.upsert).toHaveBeenCalledWith(
        expect.objectContaining({ profileId: targetId, rol: 'soporte', grantedBy: adminId }),
        expect.anything(),
      );
    });
  });
});
