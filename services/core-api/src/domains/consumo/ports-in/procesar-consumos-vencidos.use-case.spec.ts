import { TRANSACTION_MANAGER } from '../../../shared/database/transaction';
import {
  EVENT_PUBLISHER,
  type EventPublisher,
} from '../../../shared/event-bus/event-publisher.port';
import {
  NOTIFICATION_PORT,
  type NotificationPort,
} from '../../../shared/notifications/notification.port';
import { UMBRAL_STOCK_BAJO_DIAS } from '../domain/consumo.constants';
import { RefillAutoSolicitado } from '../events/refill-auto-solicitado.event';
import { StockBajoDetectado } from '../events/stock-bajo-detectado.event';
import {
  CONSUMPTION_REPOSITORY,
  type ConsumptionCandidata,
  type ConsumptionRepository,
} from '../ports-out/consumption-repository.port';
import { ProcesarConsumosVencidosUseCase } from './procesar-consumos-vencidos.use-case';

// core-api-consumo spec: "procesarConsumosVencidos emits at most one
// notification pair per UserConsumption while a condition stays unresolved
// across cron runs" (D5) + "...emits one event per affected item, never a
// daily summary" (D3) + "A single item's processing failure does not block
// the rest of the cron run" (D4) + "...never fails because a user has no
// registered push token" (D10) + "procesarConsumosVencidos is internal-only
// — never HTTP-reachable and carries no @Roles decorator" (D2).
//
// design.md Diagram 1 is the exact per-item flow this spec pins down:
// 2a (pure calculos) -> 2b (rama limpieza) / 2c (no-op) / 2d (rama disparo,
// reclaim-before-emit, D-E) -> 2e/2f/2g (fan-out + push).

// NestJS stores every `@Inject(TOKEN)`-decorated constructor parameter's
// token under this Reflect metadata key (`SELF_DECLARED_DEPS_METADATA` in
// `@nestjs/common/constants.ts`). Same technique `catalogo`'s
// `CargarCatalogoMasivoUseCase` spec established for its own D2 structural
// guarantee (no `TRANSACTION_MANAGER`) — hardcoded here rather than
// importing the package's internal subpath, to stay decoupled from an
// undocumented Nest internal import path while still proving the real DI
// wiring structurally.
const SELF_DECLARED_DEPS_METADATA = 'self:paramtypes';

function buildRepository(): jest.Mocked<ConsumptionRepository> {
  return {
    save: jest.fn(),
    findById: jest.fn(),
    findDueForCheck: jest.fn(),
    intentarMarcarStockBajo: jest.fn(),
    limpiarMarcaStockBajo: jest.fn(),
    descontarStock: jest.fn(),
    findByUserId: jest.fn(),
  };
}

function buildEventPublisher(): jest.Mocked<EventPublisher> {
  return { publish: jest.fn().mockResolvedValue(undefined) };
}

function buildNotificationPort(): jest.Mocked<NotificationPort> {
  // PR5's real ExpoPushNotificationAdapter contract: sendPush NEVER throws,
  // neither for a missing token nor an internal error (D10/D-G) — the mock
  // always resolves, mirroring that no-op-safe contract.
  return { sendPush: jest.fn().mockResolvedValue(undefined) };
}

/**
 * `dosisPorToma: 1, horarios: ['08:00'], frecuenciaDias: 1` ->
 * `consumoDiario = 1`, so `diasRestantes = stockActual` exactly — keeps the
 * arithmetic trivial to reason about per test. `stockActual: 3` is under
 * `UMBRAL_STOCK_BAJO_DIAS` (7); `stockActual: 100` is comfortably above it.
 */
function candidata(overrides: Partial<ConsumptionCandidata> = {}): ConsumptionCandidata {
  return {
    id: 'consumption-1',
    userId: 'user-a',
    ownerType: 'self',
    kind: 'medicamento',
    nombre: 'Losartan',
    dosisPorToma: 1,
    frecuenciaDias: 1,
    horarios: ['08:00'],
    stockActual: 3,
    autoCrearRefill: false,
    stockBajoNotificadoAt: null,
    ...overrides,
  };
}

function buildUseCase(
  consumptionRepository: jest.Mocked<ConsumptionRepository>,
  eventPublisher: jest.Mocked<EventPublisher>,
  notificationPort: jest.Mocked<NotificationPort>,
): ProcesarConsumosVencidosUseCase {
  return new ProcesarConsumosVencidosUseCase(
    consumptionRepository,
    eventPublisher,
    notificationPort,
  );
}

function stockBajoPublishes(eventPublisher: jest.Mocked<EventPublisher>): StockBajoDetectado[] {
  return eventPublisher.publish.mock.calls
    .map(([event]) => event)
    .filter((event): event is StockBajoDetectado => event instanceof StockBajoDetectado);
}

function refillPublishes(eventPublisher: jest.Mocked<EventPublisher>): RefillAutoSolicitado[] {
  return eventPublisher.publish.mock.calls
    .map(([event]) => event)
    .filter((event): event is RefillAutoSolicitado => event instanceof RefillAutoSolicitado);
}

describe('ProcesarConsumosVencidosUseCase', () => {
  describe('estructural (D2/D4): sin @Roles, sin ruta HTTP, sin TRANSACTION_MANAGER', () => {
    it('el constructor inyecta EXACTAMENTE CONSUMPTION_REPOSITORY, EVENT_PUBLISHER y NOTIFICATION_PORT — nunca TRANSACTION_MANAGER', () => {
      const injectedTokens: Array<{ index: number; param: unknown }> =
        Reflect.getMetadata(SELF_DECLARED_DEPS_METADATA, ProcesarConsumosVencidosUseCase) ?? [];

      expect(injectedTokens).toHaveLength(3);
      const tokens = injectedTokens.map((dep) => dep.param);
      expect(tokens).not.toContain(TRANSACTION_MANAGER);
      expect(tokens).toEqual(
        expect.arrayContaining([CONSUMPTION_REPOSITORY, EVENT_PUBLISHER, NOTIFICATION_PORT]),
      );
    });
  });

  describe('debounce (D5): dos corridas consecutivas sobre la misma condición sin resolver', () => {
    it('emiten exactamente UN par de eventos en total across ambas corridas, no dos', async () => {
      const consumptionRepository = buildRepository();
      const eventPublisher = buildEventPublisher();
      const notificationPort = buildNotificationPort();
      const item = candidata({ autoCrearRefill: true });
      consumptionRepository.findDueForCheck.mockResolvedValue([item]);
      consumptionRepository.intentarMarcarStockBajo
        .mockResolvedValueOnce(true) // primera corrida: gana el claim
        .mockResolvedValueOnce(false); // segunda corrida: ya reclamada (D5)
      const useCase = buildUseCase(consumptionRepository, eventPublisher, notificationPort);

      await useCase.execute();
      await useCase.execute();

      expect(consumptionRepository.intentarMarcarStockBajo).toHaveBeenCalledTimes(2);
      expect(stockBajoPublishes(eventPublisher)).toHaveLength(1);
      expect(refillPublishes(eventPublisher)).toHaveLength(1);
      expect(notificationPort.sendPush).toHaveBeenCalledTimes(1);
    });
  });

  describe('debounce: ciclo completo — se limpia y vuelve a notificar tras repuesto+recaída', () => {
    it('dispara -> limpia (rama 2b) -> vuelve a disparar', async () => {
      const consumptionRepository = buildRepository();
      const eventPublisher = buildEventPublisher();
      const notificationPort = buildNotificationPort();
      const useCase = buildUseCase(consumptionRepository, eventPublisher, notificationPort);

      // Corrida 1: bajo el umbral, marcador aún cerrado -> dispara.
      consumptionRepository.findDueForCheck.mockResolvedValueOnce([
        candidata({ stockActual: 3, stockBajoNotificadoAt: null }),
      ]);
      consumptionRepository.intentarMarcarStockBajo.mockResolvedValueOnce(true);
      await useCase.execute();

      // Corrida 2: repuesto sobre el umbral, marcador todavía abierto -> limpia.
      consumptionRepository.findDueForCheck.mockResolvedValueOnce([
        candidata({ stockActual: 100, stockBajoNotificadoAt: '2026-08-01T09:00:00.000Z' }),
      ]);
      await useCase.execute();

      // Corrida 3: cae de nuevo, marcador ya limpio -> vuelve a disparar.
      consumptionRepository.findDueForCheck.mockResolvedValueOnce([
        candidata({ stockActual: 3, stockBajoNotificadoAt: null }),
      ]);
      consumptionRepository.intentarMarcarStockBajo.mockResolvedValueOnce(true);
      await useCase.execute();

      expect(consumptionRepository.limpiarMarcaStockBajo).toHaveBeenCalledTimes(1);
      expect(consumptionRepository.limpiarMarcaStockBajo).toHaveBeenCalledWith('consumption-1');
      expect(stockBajoPublishes(eventPublisher)).toHaveLength(2); // corrida 1 + corrida 3
    });
  });

  describe('rama limpieza (2b) y no-op (2c)', () => {
    it('diasRestantes >= UMBRAL y marcador abierto -> limpiarMarcaStockBajo, cero eventos, cero push', async () => {
      const consumptionRepository = buildRepository();
      const eventPublisher = buildEventPublisher();
      const notificationPort = buildNotificationPort();
      consumptionRepository.findDueForCheck.mockResolvedValue([
        candidata({ stockActual: 100, stockBajoNotificadoAt: '2026-08-01T09:00:00.000Z' }),
      ]);
      const useCase = buildUseCase(consumptionRepository, eventPublisher, notificationPort);

      await useCase.execute();

      expect(consumptionRepository.limpiarMarcaStockBajo).toHaveBeenCalledWith('consumption-1');
      expect(consumptionRepository.intentarMarcarStockBajo).not.toHaveBeenCalled();
      expect(eventPublisher.publish).not.toHaveBeenCalled();
      expect(notificationPort.sendPush).not.toHaveBeenCalled();
    });

    it('diasRestantes >= UMBRAL y marcador ya limpio (banda [U,U+1) del +1 de D-C) -> no-op', async () => {
      const consumptionRepository = buildRepository();
      const eventPublisher = buildEventPublisher();
      const notificationPort = buildNotificationPort();
      consumptionRepository.findDueForCheck.mockResolvedValue([
        candidata({ stockActual: 100, stockBajoNotificadoAt: null }),
      ]);
      const useCase = buildUseCase(consumptionRepository, eventPublisher, notificationPort);

      await useCase.execute();

      expect(consumptionRepository.limpiarMarcaStockBajo).not.toHaveBeenCalled();
      expect(consumptionRepository.intentarMarcarStockBajo).not.toHaveBeenCalled();
      expect(eventPublisher.publish).not.toHaveBeenCalled();
      expect(notificationPort.sendPush).not.toHaveBeenCalled();
    });
  });

  describe('fan-out (D3): N ítems disparan N eventos StockBajoDetectado separados', () => {
    it('nunca un evento resumen', async () => {
      const consumptionRepository = buildRepository();
      const eventPublisher = buildEventPublisher();
      const notificationPort = buildNotificationPort();
      consumptionRepository.findDueForCheck.mockResolvedValue([
        candidata({ id: 'c-1' }),
        candidata({ id: 'c-2' }),
        candidata({ id: 'c-3' }),
      ]);
      consumptionRepository.intentarMarcarStockBajo.mockResolvedValue(true);
      const useCase = buildUseCase(consumptionRepository, eventPublisher, notificationPort);

      await useCase.execute();

      const publishes = stockBajoPublishes(eventPublisher);
      expect(publishes).toHaveLength(3);
      expect(publishes.map((event) => event.payload.consumptionId)).toEqual(['c-1', 'c-2', 'c-3']);
    });
  });

  describe('RefillAutoSolicitado: solo si autoCrearRefill', () => {
    it('publica RefillAutoSolicitado únicamente para el ítem con autoCrearRefill=true', async () => {
      const consumptionRepository = buildRepository();
      const eventPublisher = buildEventPublisher();
      const notificationPort = buildNotificationPort();
      consumptionRepository.findDueForCheck.mockResolvedValue([
        candidata({ id: 'c-1', autoCrearRefill: true }),
        candidata({ id: 'c-2', autoCrearRefill: false }),
      ]);
      consumptionRepository.intentarMarcarStockBajo.mockResolvedValue(true);
      const useCase = buildUseCase(consumptionRepository, eventPublisher, notificationPort);

      await useCase.execute();

      expect(stockBajoPublishes(eventPublisher)).toHaveLength(2);
      const refills = refillPublishes(eventPublisher);
      expect(refills).toHaveLength(1);
      expect(refills[0]!.payload.consumptionId).toBe('c-1');
    });
  });

  describe('aislamiento de fallas (D4)', () => {
    it('un ítem que falla se captura y loguea; los demás se procesan y notifican normalmente', async () => {
      const consumptionRepository = buildRepository();
      const eventPublisher = buildEventPublisher();
      const notificationPort = buildNotificationPort();
      consumptionRepository.findDueForCheck.mockResolvedValue([
        candidata({ id: 'c-fail' }),
        candidata({ id: 'c-ok-1' }),
        candidata({ id: 'c-ok-2' }),
      ]);
      consumptionRepository.intentarMarcarStockBajo.mockImplementation(async (id: string) => {
        if (id === 'c-fail') throw new Error('boom');
        return true;
      });
      const useCase = buildUseCase(consumptionRepository, eventPublisher, notificationPort);

      await expect(useCase.execute()).resolves.toBeUndefined();

      const publishes = stockBajoPublishes(eventPublisher);
      expect(publishes.map((event) => event.payload.consumptionId)).toEqual(['c-ok-1', 'c-ok-2']);
    });

    it('un fallo en limpiarMarcaStockBajo tampoco detiene el resto del lote', async () => {
      const consumptionRepository = buildRepository();
      const eventPublisher = buildEventPublisher();
      const notificationPort = buildNotificationPort();
      consumptionRepository.findDueForCheck.mockResolvedValue([
        candidata({
          id: 'c-fail',
          stockActual: 100,
          stockBajoNotificadoAt: '2026-08-01T09:00:00.000Z',
        }),
        candidata({ id: 'c-ok', stockActual: 3, stockBajoNotificadoAt: null }),
      ]);
      consumptionRepository.limpiarMarcaStockBajo.mockRejectedValueOnce(new Error('db down'));
      consumptionRepository.intentarMarcarStockBajo.mockResolvedValue(true);
      const useCase = buildUseCase(consumptionRepository, eventPublisher, notificationPort);

      await expect(useCase.execute()).resolves.toBeUndefined();

      expect(
        stockBajoPublishes(eventPublisher).map((event) => event.payload.consumptionId),
      ).toEqual(['c-ok']);
    });
  });

  describe('push best-effort (D10/D-G)', () => {
    it('sendPush resolviendo normalmente (no-op-safe) no cuenta como fallo del ítem', async () => {
      const consumptionRepository = buildRepository();
      const eventPublisher = buildEventPublisher();
      const notificationPort = buildNotificationPort();
      consumptionRepository.findDueForCheck.mockResolvedValue([candidata()]);
      consumptionRepository.intentarMarcarStockBajo.mockResolvedValue(true);
      const useCase = buildUseCase(consumptionRepository, eventPublisher, notificationPort);

      await useCase.execute();

      expect(notificationPort.sendPush).toHaveBeenCalledTimes(1);
      expect(notificationPort.sendPush).toHaveBeenCalledWith('user-a', expect.any(String));
      expect(stockBajoPublishes(eventPublisher)).toHaveLength(1);
    });
  });

  describe('reclamar antes de emitir (D-E)', () => {
    it('intentarMarcarStockBajo se resuelve ANTES que cualquier publish/sendPush del mismo ítem', async () => {
      const consumptionRepository = buildRepository();
      const eventPublisher = buildEventPublisher();
      const notificationPort = buildNotificationPort();
      const orden: string[] = [];
      consumptionRepository.findDueForCheck.mockResolvedValue([candidata()]);
      consumptionRepository.intentarMarcarStockBajo.mockImplementation(async () => {
        orden.push('intentarMarcarStockBajo');
        return true;
      });
      eventPublisher.publish.mockImplementation(async () => {
        orden.push('publish');
      });
      notificationPort.sendPush.mockImplementation(async () => {
        orden.push('sendPush');
      });
      const useCase = buildUseCase(consumptionRepository, eventPublisher, notificationPort);

      await useCase.execute();

      expect(orden[0]).toBe('intentarMarcarStockBajo');
      expect(orden.slice(1)).toEqual(['publish', 'sendPush']);
    });

    it('si intentarMarcarStockBajo devuelve false, NUNCA se llama a publish ni a sendPush', async () => {
      const consumptionRepository = buildRepository();
      const eventPublisher = buildEventPublisher();
      const notificationPort = buildNotificationPort();
      consumptionRepository.findDueForCheck.mockResolvedValue([candidata()]);
      consumptionRepository.intentarMarcarStockBajo.mockResolvedValue(false);
      const useCase = buildUseCase(consumptionRepository, eventPublisher, notificationPort);

      await useCase.execute();

      expect(eventPublisher.publish).not.toHaveBeenCalled();
      expect(notificationPort.sendPush).not.toHaveBeenCalled();
    });
  });

  describe('payload del evento (D-D)', () => {
    it('construye StockBajoPayload con los campos calculados y umbralDias, mapeando petId/unidad ausentes a null', async () => {
      const consumptionRepository = buildRepository();
      const eventPublisher = buildEventPublisher();
      const notificationPort = buildNotificationPort();
      consumptionRepository.findDueForCheck.mockResolvedValue([
        candidata({
          id: 'c-1',
          userId: 'user-x',
          ownerType: 'self',
          kind: 'medicamento',
          nombre: 'Losartan',
          dosisPorToma: 1,
          horarios: ['08:00'],
          frecuenciaDias: 1,
          stockActual: 3,
          unidad: undefined,
          petId: undefined,
        }),
      ]);
      consumptionRepository.intentarMarcarStockBajo.mockResolvedValue(true);
      const useCase = buildUseCase(consumptionRepository, eventPublisher, notificationPort);

      await useCase.execute();

      const [event] = stockBajoPublishes(eventPublisher);
      expect(event!.payload).toEqual({
        consumptionId: 'c-1',
        userId: 'user-x',
        ownerType: 'self',
        petId: null,
        kind: 'medicamento',
        nombre: 'Losartan',
        unidad: null,
        stockActual: 3,
        consumoDiario: 1,
        diasRestantes: 3,
        umbralDias: UMBRAL_STOCK_BAJO_DIAS,
      });
    });

    it('StockBajoDetectado y RefillAutoSolicitado comparten el MISMO payload (D-D)', async () => {
      const consumptionRepository = buildRepository();
      const eventPublisher = buildEventPublisher();
      const notificationPort = buildNotificationPort();
      consumptionRepository.findDueForCheck.mockResolvedValue([
        candidata({ autoCrearRefill: true }),
      ]);
      consumptionRepository.intentarMarcarStockBajo.mockResolvedValue(true);
      const useCase = buildUseCase(consumptionRepository, eventPublisher, notificationPort);

      await useCase.execute();

      const [detectado] = stockBajoPublishes(eventPublisher);
      const [refill] = refillPublishes(eventPublisher);
      expect(refill!.payload).toEqual(detectado!.payload);
    });
  });
});

// core-api-consumo spec: "procesarConsumosVencidos has no HTTP surface" —
// there is nothing to assert in a `.spec.ts` for the ABSENCE of a
// controller binding; verified instead by inspection/grep, same as this
// codebase's other structural "never wired" guarantees when no runtime
// test would meaningfully catch a regression:
//   `grep -rn "ProcesarConsumosVencidosUseCase" src/domains/consumo/adapters/http/`
// returns zero matches, and no `@Roles()` decorator exists anywhere for
// this use case — see the PR6b apply-progress report for the exact command
// and output.
