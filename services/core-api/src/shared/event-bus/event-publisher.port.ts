import type { DomainEvent } from './domain-event';

/**
 * `EVENT_PUBLISHER` lives in the shared kernel, not any one domain's
 * ports-out (design.md's DI-token table): `identidad`, `ofertas`, and
 * `pedidos-pagos` all depend on it, so a single kernel-owned `Symbol`
 * avoids three colliding string-token declarations.
 */
export interface EventPublisher {
  publish(event: DomainEvent): Promise<void>;
}

export const EVENT_PUBLISHER = Symbol('EVENT_PUBLISHER');
