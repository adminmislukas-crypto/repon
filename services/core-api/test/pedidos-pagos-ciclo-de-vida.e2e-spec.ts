import { randomUUID } from 'node:crypto';
import { INestApplication, ValidationPipe } from '@nestjs/common';
import { Test } from '@nestjs/testing';
import type { Order, Payment } from '@repon/types';
import { SignJWT } from 'jose';
import request from 'supertest';
import { AppModule } from '../src/app.module';
import {
  ORDER_REPOSITORY,
  type OrderRepository,
} from '../src/domains/pedidos-pagos/ports-out/order-repository.port';
import {
  PAYMENT_REPOSITORY,
  type PaymentRepository,
} from '../src/domains/pedidos-pagos/ports-out/payment-repository.port';
import { GlobalExceptionFilter } from '../src/shared/auth/global-exception.filter';
import {
  ACTOR_PORT,
  type ActorPort,
  type AuthenticatedActor,
} from '../src/shared/auth/ports/actor.port';

/**
 * core-api-pedidos-pagos spec / design.md D-E, D4 — el ciclo de vida
 * completo end to end: "Authorization on every actor-facing route is 404,
 * never 403, byte-identical between nonexistent and cross-tenant" para las
 * 3 rutas, y "An unconfigured payment gateway fails explicitly, and the
 * process still boots".
 *
 * Mismo override que toda la cadena `ofertas`/`pedidos-pagos` — REAL
 * `AuthGuard`/`RolesGuard`/`ValidationPipe`/`PedidosPagosExceptionFilter`;
 * solo `ACTOR_PORT`/`ORDER_REPOSITORY`/`PAYMENT_REPOSITORY` overridden.
 * **Deliberadamente NO se overridea `PAYMENT_GATEWAY_PORT`**: la app entera
 * arranca con el binding REAL de `SharedKernelModule`
 * (`PasarelaNoConfiguradaAdapter`, design.md C.2) — es exactamente lo que
 * la tarea 6.8 necesita probar: el proceso bootea igual sin credenciales, y
 * `iniciarPago` falla explícito con 503, nunca un boot roto.
 *
 * IDs de actor y de pedido son `randomUUID()`: `AuthGuard` rechaza con 401
 * un `sub` que no matchea `UUID_RE`, y `ParseUUIDPipe` en `:orderId`
 * rechaza con 400 cualquier path param que no sea UUID — ambos guards
 * REALES en este e2e, mismo motivo por el que el propio `ofertas-aceptar-
 * oferta.e2e-spec.ts` usa `randomUUID()` en vez de strings literales.
 */
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

function orderFixture(overrides: Partial<Order> = {}): Order {
  return {
    id: 'order-1',
    offerId: 'offer-1',
    userId: 'user-owner',
    companyId: 'company-owner',
    status: 'pendiente_pago',
    total: 14990,
    costoDespacho: 2000,
    ...overrides,
  };
}

function paymentFixture(overrides: Partial<Payment> = {}): Payment {
  return {
    id: 'payment-1',
    orderId: 'order-1',
    gateway: 'webpay',
    externalTransactionId: 'txn-1',
    monto: 14990,
    moneda: 'CLP',
    estado: 'pendiente',
    ...overrides,
  };
}

describe('pedidos-pagos — ciclo de vida (e2e)', () => {
  let app: INestApplication;
  let actorPort: jest.Mocked<ActorPort>;
  let orderRepository: jest.Mocked<OrderRepository>;
  let paymentRepository: jest.Mocked<PaymentRepository>;
  let orderId: string;

  beforeAll(async () => {
    actorPort = { findActorById: jest.fn() };
    orderRepository = {
      crear: jest.fn(),
      findById: jest.fn(),
      findByOfferId: jest.fn(),
      transicionar: jest.fn(),
    };
    paymentRepository = {
      crear: jest.fn(),
      findByExternalTransactionId: jest.fn(),
      findUltimoPorPedido: jest.fn(),
      marcarResultado: jest.fn(),
    };

    const moduleRef = await Test.createTestingModule({ imports: [AppModule] })
      .overrideProvider(ACTOR_PORT)
      .useValue(actorPort)
      .overrideProvider(ORDER_REPOSITORY)
      .useValue(orderRepository)
      .overrideProvider(PAYMENT_REPOSITORY)
      .useValue(paymentRepository)
      .compile();

    app = moduleRef.createNestApplication();
    app.useGlobalPipes(
      new ValidationPipe({ whitelist: true, forbidNonWhitelisted: true, transform: true }),
    );
    app.useGlobalFilters(new GlobalExceptionFilter());
    await app.init();
  });

  beforeEach(() => {
    orderId = randomUUID();
  });

  afterEach(() => jest.clearAllMocks());

  afterAll(async () => {
    await app.close();
  });

  // design.md D4 — "404, never 403, byte-identical between nonexistent and cross-tenant"
  describe('404 cross-tenant en las 3 rutas (D4)', () => {
    it('POST /pedidos/:orderId/pago returns 404 for an order owned by a different user', async () => {
      const actorId = randomUUID();
      actorPort.findActorById.mockResolvedValue(buildUserActor(actorId));
      orderRepository.findById.mockResolvedValue(
        orderFixture({ id: orderId, userId: randomUUID() }),
      );
      const token = await signToken(actorId);

      const res = await request(app.getHttpServer())
        .post(`/pedidos/${orderId}/pago`)
        .set('Authorization', `Bearer ${token}`);

      expect(res.status).toBe(404);
      expect(res.body.code).toBe('PEDIDO_NO_ENCONTRADO');
    });

    it('POST /pedidos/:orderId/pago on a nonexistent order returns the byte-identical 404', async () => {
      const actorId = randomUUID();
      actorPort.findActorById.mockResolvedValue(buildUserActor(actorId));
      orderRepository.findById.mockResolvedValue(null);
      const token = await signToken(actorId);

      const nonexistent = await request(app.getHttpServer())
        .post(`/pedidos/${orderId}/pago`)
        .set('Authorization', `Bearer ${token}`);
      orderRepository.findById.mockResolvedValue(
        orderFixture({ id: orderId, userId: randomUUID() }),
      );
      const crossTenant = await request(app.getHttpServer())
        .post(`/pedidos/${orderId}/pago`)
        .set('Authorization', `Bearer ${token}`);

      expect(nonexistent.status).toBe(404);
      expect(crossTenant.status).toBe(404);
      expect(nonexistent.body).toEqual(crossTenant.body);
    });

    it('GET /pedidos/:orderId/pago returns 404 for an order owned by a different user', async () => {
      const actorId = randomUUID();
      actorPort.findActorById.mockResolvedValue(buildUserActor(actorId));
      orderRepository.findById.mockResolvedValue(
        orderFixture({ id: orderId, userId: randomUUID() }),
      );
      const token = await signToken(actorId);

      const res = await request(app.getHttpServer())
        .get(`/pedidos/${orderId}/pago`)
        .set('Authorization', `Bearer ${token}`);

      expect(res.status).toBe(404);
      expect(res.body.code).toBe('PEDIDO_NO_ENCONTRADO');
    });

    it('PATCH /pedidos/:orderId/estado returns 404 for an order owned by a different company', async () => {
      const actorId = randomUUID();
      actorPort.findActorById.mockResolvedValue(
        buildProviderActor({ profileId: actorId, companyId: randomUUID() }),
      );
      orderRepository.findById.mockResolvedValue(
        orderFixture({ id: orderId, companyId: randomUUID() }),
      );
      const token = await signToken(actorId);

      const res = await request(app.getHttpServer())
        .patch(`/pedidos/${orderId}/estado`)
        .set('Authorization', `Bearer ${token}`)
        .send({ estado: 'preparando' });

      expect(res.status).toBe(404);
      expect(res.body.code).toBe('PEDIDO_NO_ENCONTRADO');
    });

    it('no DTO in this domain accepts companyId or userId', async () => {
      const actorId = randomUUID();
      const companyId = randomUUID();
      actorPort.findActorById.mockResolvedValue(
        buildProviderActor({ profileId: actorId, companyId }),
      );
      orderRepository.findById.mockResolvedValue(orderFixture({ id: orderId, companyId }));
      orderRepository.transicionar.mockResolvedValue(true);
      const token = await signToken(actorId);

      const res = await request(app.getHttpServer())
        .patch(`/pedidos/${orderId}/estado`)
        .set('Authorization', `Bearer ${token}`)
        .send({ estado: 'preparando', companyId: randomUUID() });

      // `forbidNonWhitelisted: true` rejects the unexpected field with 400.
      expect(res.status).toBe(400);
    });
  });

  describe('actualizarEstadoPedido rejects the 3 provider-unreachable states before the use case runs', () => {
    it.each(['confirmado', 'pendiente_pago', 'expirado'])(
      'PATCH /pedidos/:orderId/estado with estado=%s is rejected with 400, never reaching the use case',
      async (estadoInalcanzable) => {
        const actorId = randomUUID();
        actorPort.findActorById.mockResolvedValue(
          buildProviderActor({ profileId: actorId, companyId: randomUUID() }),
        );
        const token = await signToken(actorId);

        const res = await request(app.getHttpServer())
          .patch(`/pedidos/${orderId}/estado`)
          .set('Authorization', `Bearer ${token}`)
          .send({ estado: estadoInalcanzable });

        expect(res.status).toBe(400);
        expect(orderRepository.findById).not.toHaveBeenCalled();
      },
    );
  });

  // design.md D-C.2/R7 — task 6.8: la pasarela no configurada falla
  // explícito con 503, y el PROCESO bootea igual (ya probado por el hecho
  // de que `app.init()` en `beforeAll` resolvió sin lanzar).
  describe('pasarela no configurada (design.md C.2, task 6.8)', () => {
    it('POST /pedidos/:orderId/pago returns 503 PASARELA_NO_CONFIGURADA when no gateway is bound', async () => {
      const actorId = randomUUID();
      actorPort.findActorById.mockResolvedValue(buildUserActor(actorId));
      orderRepository.findById.mockResolvedValue(orderFixture({ id: orderId, userId: actorId }));
      const token = await signToken(actorId);

      const res = await request(app.getHttpServer())
        .post(`/pedidos/${orderId}/pago`)
        .set('Authorization', `Bearer ${token}`);

      expect(res.status).toBe(503);
      expect(res.body.code).toBe('PASARELA_NO_CONFIGURADA');
      expect(paymentRepository.crear).not.toHaveBeenCalled();
    });
  });

  describe('the happy path for obtenerEstadoPago', () => {
    it('returns 200 with the narrow EstadoPagoResponseDto for the owning user', async () => {
      const actorId = randomUUID();
      actorPort.findActorById.mockResolvedValue(buildUserActor(actorId));
      orderRepository.findById.mockResolvedValue(orderFixture({ id: orderId, userId: actorId }));
      paymentRepository.findUltimoPorPedido.mockResolvedValue(paymentFixture({ orderId }));
      const token = await signToken(actorId);

      const res = await request(app.getHttpServer())
        .get(`/pedidos/${orderId}/pago`)
        .set('Authorization', `Bearer ${token}`)
        .expect(200);

      expect(res.body).toEqual({ estado: 'pendiente', monto: 14990, moneda: 'CLP' });
      expect(res.body).not.toHaveProperty('rawPayload');
      expect(res.body).not.toHaveProperty('externalTransactionId');
    });
  });

  describe('the happy path for actualizarEstadoPedido', () => {
    it('returns 204 and transitions confirmado -> preparando for the owning company', async () => {
      const actorId = randomUUID();
      const companyId = randomUUID();
      actorPort.findActorById.mockResolvedValue(
        buildProviderActor({ profileId: actorId, companyId }),
      );
      orderRepository.findById.mockResolvedValue(
        orderFixture({ id: orderId, companyId, status: 'confirmado' }),
      );
      orderRepository.transicionar.mockResolvedValue(true);
      const token = await signToken(actorId);

      await request(app.getHttpServer())
        .patch(`/pedidos/${orderId}/estado`)
        .set('Authorization', `Bearer ${token}`)
        .send({ estado: 'preparando' })
        .expect(204);

      expect(orderRepository.transicionar).toHaveBeenCalledWith(
        orderId,
        'confirmado',
        'preparando',
      );
    });
  });
});
