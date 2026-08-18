import type { CallHandler, ExecutionContext } from '@nestjs/common';
import type { Reflector } from '@nestjs/core';
import { firstValueFrom, of, throwError, type Observable } from 'rxjs';
import { DemasiadosIntentosError } from './demasiados-intentos.error';
import { RateLimitInterceptor } from './rate-limit.interceptor';
import type { RateLimitOptions } from './rate-limit.decorator';
import type { RateLimitStore } from './rate-limit-store.port';

class FailingError extends Error {}
class OtherError extends Error {}

function createContext(request: unknown, response: { setHeader: jest.Mock }): ExecutionContext {
  return {
    getHandler: () => function handler() {},
    getClass: () => class TestController {},
    switchToHttp: () => ({
      getRequest: () => request,
      getResponse: () => response,
    }),
  } as unknown as ExecutionContext;
}

function createHandler(observable: Observable<unknown>): CallHandler {
  return { handle: jest.fn(() => observable) };
}

describe('RateLimitInterceptor', () => {
  let store: jest.Mocked<RateLimitStore>;
  let reflector: { getAllAndOverride: jest.Mock };
  let response: { setHeader: jest.Mock };

  const emailIpOptions: RateLimitOptions = {
    keys: [
      { scope: 'sesion', dimension: 'email', limit: 5, windowMs: 900_000 },
      { scope: 'sesion', dimension: 'ip', limit: 20, windowMs: 900_000 },
    ],
    resetOnSuccess: ['email'],
    countsAsFailure: (error) => error instanceof FailingError,
  };

  beforeEach(() => {
    store = {
      peek: jest.fn().mockResolvedValue({ count: 0, retryAfterMs: 0 }),
      record: jest.fn().mockResolvedValue(undefined),
      reset: jest.fn().mockResolvedValue(undefined),
    };
    reflector = { getAllAndOverride: jest.fn().mockReturnValue(emailIpOptions) };
    response = { setHeader: jest.fn() };
  });

  function buildInterceptor(): RateLimitInterceptor {
    return new RateLimitInterceptor(reflector as unknown as Reflector, store);
  }

  it('passes the request through unchanged when no @RateLimit metadata is present', async () => {
    reflector.getAllAndOverride.mockReturnValue(undefined);
    const interceptor = buildInterceptor();
    const handler = createHandler(of('ok'));
    const context = createContext({ body: {}, ip: '1.2.3.4' }, response);

    const result = await firstValueFrom(interceptor.intercept(context, handler));

    expect(result).toBe('ok');
    expect(store.peek).not.toHaveBeenCalled();
  });

  it('throws 429 and never invokes the handler when a key is at its limit', async () => {
    store.peek.mockResolvedValue({ count: 5, retryAfterMs: 42_000 });
    const interceptor = buildInterceptor();
    const handler = createHandler(of('ok'));
    const context = createContext({ body: { email: 'a@b.com' }, ip: '1.2.3.4' }, response);

    await expect(firstValueFrom(interceptor.intercept(context, handler))).rejects.toBeInstanceOf(
      DemasiadosIntentosError,
    );
    expect(handler.handle).not.toHaveBeenCalled();
  });

  it('sets Retry-After from the blocking key before throwing', async () => {
    store.peek.mockResolvedValue({ count: 5, retryAfterMs: 42_500 });
    const interceptor = buildInterceptor();
    const handler = createHandler(of('ok'));
    const context = createContext({ body: { email: 'a@b.com' }, ip: '1.2.3.4' }, response);

    await expect(firstValueFrom(interceptor.intercept(context, handler))).rejects.toBeInstanceOf(
      DemasiadosIntentosError,
    );
    expect(response.setHeader).toHaveBeenCalledWith('Retry-After', '43');
  });

  it('records nothing when a 429 is thrown', async () => {
    store.peek.mockResolvedValue({ count: 5, retryAfterMs: 1000 });
    const interceptor = buildInterceptor();
    const handler = createHandler(of('ok'));
    const context = createContext({ body: { email: 'a@b.com' }, ip: '1.2.3.4' }, response);

    await expect(firstValueFrom(interceptor.intercept(context, handler))).rejects.toBeInstanceOf(
      DemasiadosIntentosError,
    );
    expect(store.record).not.toHaveBeenCalled();
  });

  it('records on a spec-qualifying failure', async () => {
    const interceptor = buildInterceptor();
    const handler = createHandler(throwError(() => new FailingError('bad creds')));
    const context = createContext({ body: { email: 'a@b.com' }, ip: '1.2.3.4' }, response);

    await expect(firstValueFrom(interceptor.intercept(context, handler))).rejects.toBeInstanceOf(FailingError);
    expect(store.record).toHaveBeenCalledTimes(2); // email key + ip key
  });

  it('does not record on a non-qualifying failure', async () => {
    const interceptor = buildInterceptor();
    const handler = createHandler(throwError(() => new OtherError('suspended')));
    const context = createContext({ body: { email: 'a@b.com' }, ip: '1.2.3.4' }, response);

    await expect(firstValueFrom(interceptor.intercept(context, handler))).rejects.toBeInstanceOf(OtherError);
    expect(store.record).not.toHaveBeenCalled();
  });

  it('resets only the email key on success, leaving the ip key untouched', async () => {
    const interceptor = buildInterceptor();
    const handler = createHandler(of('ok'));
    const context = createContext({ body: { email: 'a@b.com' }, ip: '1.2.3.4' }, response);

    await firstValueFrom(interceptor.intercept(context, handler));

    expect(store.reset).toHaveBeenCalledTimes(1);
    const resetKey = store.reset.mock.calls[0]?.[0];
    expect(resetKey).toContain('sesion:email:');
  });

  it('fails open when the store rejects on peek — the handler still runs', async () => {
    store.peek.mockRejectedValue(new Error('store down'));
    const interceptor = buildInterceptor();
    const handler = createHandler(of('ok'));
    const context = createContext({ body: { email: 'a@b.com' }, ip: '1.2.3.4' }, response);

    const result = await firstValueFrom(interceptor.intercept(context, handler));

    expect(result).toBe('ok');
    expect(handler.handle).toHaveBeenCalled();
  });

  it('propagates the original error unchanged even when record() also rejects', async () => {
    store.record.mockRejectedValue(new Error('store down'));
    const interceptor = buildInterceptor();
    const originalError = new FailingError('bad creds');
    const handler = createHandler(throwError(() => originalError));
    const context = createContext({ body: { email: 'a@b.com' }, ip: '1.2.3.4' }, response);

    await expect(firstValueFrom(interceptor.intercept(context, handler))).rejects.toBe(originalError);
  });

  it('derives only the ip key when email is missing, without throwing', async () => {
    const interceptor = buildInterceptor();
    const handler = createHandler(of('ok'));
    const context = createContext({ body: {}, ip: '1.2.3.4' }, response);

    await firstValueFrom(interceptor.intercept(context, handler));

    expect(store.peek).toHaveBeenCalledTimes(1);
    const peekedKey = store.peek.mock.calls[0]?.[0];
    expect(peekedKey).toContain('sesion:ip:');
  });

  it('derives only the ip key when email is a non-string value, without throwing', async () => {
    const interceptor = buildInterceptor();
    const handler = createHandler(of('ok'));
    const context = createContext({ body: { email: 12345 }, ip: '1.2.3.4' }, response);

    await firstValueFrom(interceptor.intercept(context, handler));

    expect(store.peek).toHaveBeenCalledTimes(1);
    const peekedKey = store.peek.mock.calls[0]?.[0];
    expect(peekedKey).toContain('sesion:ip:');
  });
});
