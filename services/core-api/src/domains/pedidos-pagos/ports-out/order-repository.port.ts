import type { Order } from '@repon/types';
import type { TransactionContext } from '../../../shared/database/transaction';

/**
 * `pedidos-pagos/SPEC.md`, "Puertos de salida" — thin placeholder
 * (exploration.md D2). Interface + DI token only.
 * `PaymentGatewayPort`/`NotificationPort`/`EventPublisher`, also listed in
 * `SPEC.md`'s ports-out block, are shared-kernel infrastructure
 * (`PAYMENT_GATEWAY_PORT`/`NOTIFICATION_PORT`/`EVENT_PUBLISHER`, already
 * declared in `shared/payments`/`shared/notifications`/`shared/event-bus`
 * per design.md's DI-wiring convention) and not redeclared here.
 */
export interface OrderRepository {
  save(order: Order, tx?: TransactionContext): Promise<void>;
  findById(id: string, tx?: TransactionContext): Promise<Order | null>;
}

export const ORDER_REPOSITORY = Symbol('ORDER_REPOSITORY');
