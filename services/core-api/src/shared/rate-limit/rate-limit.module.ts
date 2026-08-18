import { Module } from '@nestjs/common';
import { InMemoryRateLimitStore } from './in-memory-rate-limit.store';
import { RATE_LIMIT_STORE } from './rate-limit-store.port';
import { RateLimitInterceptor } from './rate-limit.interceptor';

@Module({
  providers: [{ provide: RATE_LIMIT_STORE, useClass: InMemoryRateLimitStore }, RateLimitInterceptor],
  // Both exported, not just the interceptor: `@UseInterceptors(RateLimitInterceptor)`
  // (a class reference, not an instance) makes the *consuming* module's own
  // injector resolve RateLimitInterceptor's constructor args — so
  // RATE_LIMIT_STORE must be visible there too, or resolution fails with
  // "Nest can't resolve dependencies of RateLimitInterceptor" the moment a
  // route actually uses the decorator (only caught by an e2e/DI-wiring test,
  // never by a plain unit test that constructs the class manually).
  exports: [RateLimitInterceptor, RATE_LIMIT_STORE],
})
export class RateLimitModule {}
