import { InMemoryRateLimitStore } from './in-memory-rate-limit.store';
import type { RateLimitWindow } from './rate-limit-store.port';

describe('InMemoryRateLimitStore', () => {
  const window: RateLimitWindow = { windowMs: 900_000, limit: 5 };

  beforeEach(() => {
    jest.useFakeTimers();
    jest.setSystemTime(0);
  });

  afterEach(() => {
    jest.useRealTimers();
  });

  it('counts failures recorded within the window', async () => {
    const store = new InMemoryRateLimitStore();
    for (let i = 0; i < 5; i++) {
      await store.record('k1', window);
    }

    expect((await store.peek('k1', window)).count).toBe(5);
  });

  it('does not use fixed-bucket rollover at a window boundary', async () => {
    const store = new InMemoryRateLimitStore();
    for (let i = 0; i < 4; i++) {
      await store.record('k1', window);
    }

    jest.setSystemTime(16 * 60_000);
    await store.record('k1', window);

    expect((await store.peek('k1', window)).count).toBe(1);
  });

  it('ages failures out of the trailing window, dropping the count', async () => {
    const store = new InMemoryRateLimitStore();
    for (let i = 0; i < 5; i++) {
      await store.record('k1', window);
    }

    expect((await store.peek('k1', window)).count).toBe(5);

    jest.setSystemTime(window.windowMs + 1);

    expect((await store.peek('k1', window)).count).toBe(0);
  });

  it('computes retryAfterMs from the limit-th most recent failure', async () => {
    const store = new InMemoryRateLimitStore();
    for (let i = 0; i < 5; i++) {
      jest.setSystemTime(i * 1000);
      await store.record('k1', window);
    }

    jest.setSystemTime(5000);
    const result = await store.peek('k1', window);

    expect(result.count).toBe(5);
    expect(result.retryAfterMs).toBe(0 + window.windowMs - 5000);
  });

  it('returns retryAfterMs 0 while under the limit', async () => {
    const store = new InMemoryRateLimitStore();
    await store.record('k1', window);

    const result = await store.peek('k1', window);

    expect(result.count).toBe(1);
    expect(result.retryAfterMs).toBe(0);
  });

  it('never retains more than `limit` timestamps per key', async () => {
    const store = new InMemoryRateLimitStore();
    for (let i = 0; i < 20; i++) {
      jest.setSystemTime(i * 1000);
      await store.record('k1', window);
    }

    jest.setSystemTime(19_000);

    expect((await store.peek('k1', window)).count).toBe(5);
  });

  it('reset isolates one key from another', async () => {
    const store = new InMemoryRateLimitStore();
    await store.record('k1', window);
    await store.record('k2', window);

    await store.reset('k1');

    expect((await store.peek('k1', window)).count).toBe(0);
    expect((await store.peek('k2', window)).count).toBe(1);
  });

  it('evicts an expired key from the underlying map on access', async () => {
    const store = new InMemoryRateLimitStore();
    await store.record('k1', window);

    jest.setSystemTime(window.windowMs + 1);
    await store.peek('k1', window);

    expect(store.size()).toBe(0);
  });

  it('does not create a map entry for a key that was never recorded', async () => {
    const store = new InMemoryRateLimitStore();

    expect((await store.peek('never-seen', window)).count).toBe(0);
    expect(store.size()).toBe(0);
  });
});
