import { deepEqual, equal, rejects } from 'node:assert/strict';
import { describe, it, mock } from 'node:test';
import type { Mock } from 'node:test';
import { Response } from 'cross-fetch';
import { fetchBuilder as builder } from '../src/index.mjs';

const url = 'https://example.test';
const response = (status: number): Response => new Response(String(status), { status });
type TestInput = string | { signal: AbortSignal };
interface TestInit {
    signal?: AbortSignal | null;
}
type TestFetch = (input: TestInput, init?: TestInit) => Promise<Response>;
const mockFetch = (implementation: TestFetch): Mock<TestFetch> => mock.fn(implementation);
const sequence = (...values: (Response | Error)[]): Mock<TestFetch> =>
    mockFetch(async () => {
        const value = values.shift();
        if (value instanceof Error) {
            throw value;
        }
        if (!value) {
            throw new Error('Sequence exhausted');
        }
        return value;
    });

describe('fetch builder and retry', () => {
    it('returns a function and applies defaults', async () => {
        const fetch = sequence(response(503), response(504));
        const wrapped = builder(fetch, { retries: 0 });
        equal(typeof wrapped, 'function');
        equal((await wrapped(url)).status, 503);
        equal(fetch.mock.callCount(), 1);
    });

    it('passes arguments and returns the original successful response', async () => {
        const expected = response(200);
        const fetch = mockFetch(async () => expected);
        const result = await builder(fetch)(url);
        equal(result, expected);
        equal(result.retryCount, 0);
        deepEqual(fetch.mock.calls[0].arguments, [url, undefined]);
        equal(fetch.mock.callCount(), 1);
    });

    it('rejects the original error after all attempts', async () => {
        const error = new TypeError('FAIL');
        const fetch = mockFetch(async () => {
            throw error;
        });
        await rejects(
            builder(fetch, { retries: 3, retryDelay: 0 })(url),
            (e) => e === error && (e as Error & { retryCount: number }).retryCount === 3,
        );
        equal(fetch.mock.callCount(), 4);
    });

    it('returns the last failed response after all attempts', async () => {
        const fetch = sequence(response(503), response(504), response(419));
        const result = await builder(fetch, { retries: 2, retryDelay: 0 })(url);
        equal(result.status, 419);
        equal(result.retryCount, 2);
        equal(fetch.mock.callCount(), 3);
    });

    it('returns the first successful response', async () => {
        const fetch = sequence(new Error('FAIL'), response(503), response(504), response(200), response(419));
        const result = await builder(fetch, { retries: 4, retryDelay: 0 })(url);
        equal(result.status, 200);
        equal(result.retryCount, 3);
        equal(fetch.mock.callCount(), 4);
    });

    it('adds zero retries to the original error when retries are disabled', async () => {
        const error = new TypeError('failed');
        const fetch = mockFetch(async () => {
            throw error;
        });
        await rejects(
            builder(fetch, { retries: 0 })(url),
            (e) => e === error && (e as Error & { retryCount: number }).retryCount === 0,
        );
    });

    it('normalizes non-Error rejections and records retries', async () => {
        // Verify that non-Error rejections are normalized.
        // eslint-disable-next-line prefer-promise-reject-errors, @typescript-eslint/prefer-promise-reject-errors
        const fetch = mockFetch(async () => Promise.reject('failed'));
        await rejects(builder(fetch, { retries: 1, retryDelay: 0 })(url), { message: 'failed', retryCount: 1 });
    });

    it('rejects callback errors without retrying', async () => {
        const error = new Error('callback failed');
        const fetch = mockFetch(async () => response(200));
        const retryOn = mock.fn(() => {
            throw error;
        });
        await rejects(builder(fetch, { retryOn })(url), (e) => e === error);
        equal(fetch.mock.callCount(), 1);
        equal(retryOn.mock.callCount(), 1);
    });

    it('rejects errors thrown by the delay callback', async () => {
        const error = new Error('delay failed');
        const fetch = mockFetch(async () => response(503));
        await rejects(
            builder(fetch, {
                retryDelay: () => {
                    throw error;
                },
            })(url),
            (e) => e === error,
        );
        equal(fetch.mock.callCount(), 1);
    });

    it('prefers init to defaults', async () => {
        const delayFn = mock.fn(() => 0);
        const retryFn = mock.fn(() => false);
        const fetch = sequence(response(503), response(504), response(419));
        const result = await builder(fetch, { retries: 1, retryDelay: delayFn, retryOn: retryFn })(url, {
            retries: 2,
            retryDelay: 0,
            retryOn: [419, 503, 504],
        });
        equal(result.status, 419);
        equal(fetch.mock.callCount(), 3);
        equal(delayFn.mock.callCount(), 0);
        equal(retryFn.mock.callCount(), 0);
    });

    it('calls retry functions', async () => {
        const delayFn = mock.fn(() => 0);
        const retryFn = mock.fn((attempt: number) => attempt === 0);
        const fetch = sequence(response(503), response(504), response(419));
        const result = await builder(fetch)(url, { retries: 3, retryDelay: delayFn, retryOn: retryFn });
        equal(result.status, 504);
        equal(result.retryCount, 1);
        equal(fetch.mock.callCount(), 2);
        equal(retryFn.mock.callCount(), 2);
        equal(delayFn.mock.callCount(), 1);
    });
});

describe('abort signals', () => {
    it('does not start an already aborted request', async () => {
        const controller = new AbortController();
        const reason = new Error('cancelled');
        controller.abort(reason);
        const fetch = mockFetch(async () => response(200));
        const retryOn = mock.fn(() => true);
        await rejects(builder(fetch, { retryOn })('url', { signal: controller.signal }), (e) => e === reason);
        equal(fetch.mock.callCount(), 0);
        equal(retryOn.mock.callCount(), 0);
    });

    it('uses an AbortError when an older signal has no reason', async () => {
        const fetch = mockFetch(async () => response(200));
        await rejects(builder(fetch)('url', { signal: { aborted: true } as AbortSignal }), {
            name: 'AbortError',
        });
        equal(fetch.mock.callCount(), 0);
    });

    it('aborts an in-flight request even if fetch does not react', async () => {
        const controller = new AbortController();
        const reason = new Error('cancelled');
        const fetch = mockFetch(
            () =>
                new Promise(() => {
                    /* Intentionally never settles. */
                }),
        );
        const retryOn = mock.fn(() => true);
        const pending = builder(fetch, { retryOn })('url', { signal: controller.signal });
        controller.abort(reason);
        await rejects(pending, (e) => e === reason);
        equal(fetch.mock.callCount(), 1);
        equal(retryOn.mock.callCount(), 0);
    });

    it('handles an abort triggered synchronously by fetch', async () => {
        const controller = new AbortController();
        const fetch = mockFetch(() => {
            controller.abort('cancelled');
            return Promise.reject(new Error('fetch failed'));
        });
        await rejects(builder(fetch)('url', { signal: controller.signal }), (e) => e === 'cancelled');
        equal(fetch.mock.callCount(), 1);
    });

    it('cancels a retry delay and clears its timer', async (t) => {
        const controller = new AbortController();
        const fetch = mockFetch(async () => response(503));
        let timer: ReturnType<typeof setTimeout> | undefined;
        const originalSetTimeout = globalThis.setTimeout;
        const setTimer = t.mock.method(globalThis, 'setTimeout', (callback: () => void, delay?: number) => {
            timer = originalSetTimeout(callback, delay);
            return timer;
        });
        const clearTimer = t.mock.method(globalThis, 'clearTimeout');
        const delay = mock.fn(() => 10000);
        const pending = builder(fetch, { retryDelay: delay })('url', { signal: controller.signal });
        await new Promise<void>((resolve): void => {
            setImmediate(resolve);
        });
        equal(delay.mock.callCount(), 1);
        equal(setTimer.mock.callCount(), 1);
        controller.abort('cancelled');
        await rejects(pending, (e) => e === 'cancelled');
        equal(clearTimer.mock.callCount(), 1);
        equal(clearTimer.mock.calls[0].arguments[0], timer);
        equal(fetch.mock.callCount(), 1);
    });

    it('uses the request signal unless an init signal overrides it', async () => {
        const controller = new AbortController();
        controller.abort('request aborted');
        const request = { signal: controller.signal };
        const fetch = mockFetch(async () => response(200));
        const wrapped = builder(fetch);
        await rejects(wrapped(request), (e) => e === 'request aborted');
        equal((await wrapped(request, { signal: new AbortController().signal })).status, 200);
        equal((await wrapped(request, { signal: null })).status, 200);
        equal(fetch.mock.callCount(), 2);
    });

    it('removes the abort listener after a completed request', async (t) => {
        const controller = new AbortController();
        const add = t.mock.method(controller.signal, 'addEventListener');
        const remove = t.mock.method(controller.signal, 'removeEventListener');
        await builder(mockFetch(async () => response(200)))('url', { signal: controller.signal });
        equal(add.mock.callCount(), 1);
        deepEqual(remove.mock.calls[0].arguments, ['abort', add.mock.calls[0].arguments[1]]);
    });

    it('does not retry an abort triggered inside retryOn', async () => {
        const controller = new AbortController();
        const fetch = mockFetch(async () => response(200));
        const retryOn = (): boolean => {
            controller.abort('cancelled');
            return false;
        };
        await rejects(builder(fetch, { retryOn })('url', { signal: controller.signal }), (e) => e === 'cancelled');
        equal(fetch.mock.callCount(), 1);
    });
});
