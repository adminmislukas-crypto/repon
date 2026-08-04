import { Injectable } from '@nestjs/common';
import { EventEmitter2 } from '@nestjs/event-emitter';
import type { DomainEvent } from './domain-event';
import type { EventPublisher } from './event-publisher.port';

/**
 * `EventPublisher` bound to `EventEmitter2` (in-process only — no broker,
 * matches this change's scope). `emitAsync` (not the sync `emit`) so a
 * caller that `await`s `publish()` genuinely waits for every listener,
 * including async ones — relevant once a domain's own event adapter
 * (`adapters/events/`, Phase 4c) does I/O in a handler.
 */
@Injectable()
export class EventEmitterPublisher implements EventPublisher {
  constructor(private readonly emitter: EventEmitter2) {}

  async publish(event: DomainEvent): Promise<void> {
    await this.emitter.emitAsync(event.type, event);
  }
}
