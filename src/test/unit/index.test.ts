import { Response } from 'cross-fetch';
import builder from '../../';

const mockedFetch = jest.fn();

describe('fetch builder', (): void => {
    it('should return a function', (): void => {
        expect(typeof builder(mockedFetch)).toBe('function');
    });

    it('should correctly apply passed defaults', async (): Promise<void> => {
        const f = builder(mockedFetch, { retries: 0 });

        mockedFetch.mockResolvedValueOnce(new Response('503', { status: 503 }));
        mockedFetch.mockResolvedValueOnce(new Response('504', { status: 504 }));

        return expect(f('https://example.test'))
            .resolves.toMatchObject({ status: 503 })
            .then((): void => {
                expect(mockedFetch.mock.calls).toHaveLength(1);
            });
    });
});

describe('fetch retry', (): void => {
    beforeEach((): void => {
        jest.resetAllMocks();
    });

    it('passes input parameter to fetch()', async (): Promise<void> => {
        const expectedParam = 'https://example.test';
        const expectedResponse = new Response('r');

        mockedFetch.mockResolvedValue(expectedResponse);
        const f = builder(mockedFetch);

        return expect(f(expectedParam))
            .resolves.toEqual(expectedResponse)
            .then((): void => {
                expect(mockedFetch).toHaveBeenCalledWith(expectedParam, undefined);
            });
    });

    it('is called only once on success (with default params)', async (): Promise<void> => {
        const expectedResponse = new Response('r');

        mockedFetch.mockResolvedValue(expectedResponse);
        const f = builder(mockedFetch);

        return expect(f('https://example.test'))
            .resolves.toEqual(expectedResponse)
            .then((): void => {
                expect(mockedFetch.mock.calls).toHaveLength(1);
            });
    });

    it('will reject if all attempts fail', async (): Promise<void> => {
        const expectedError = new TypeError('FAIL');
        mockedFetch.mockRejectedValue(expectedError);

        const retries = 3;
        const f = builder(mockedFetch, { retries, retryDelay: 0 });

        return expect(f('https://example.test'))
            .rejects.toBe(expectedError)
            .then((): void => {
                expect(expectedError).toMatchObject({ retryCount: 3 });
                expect(mockedFetch.mock.calls).toHaveLength(retries + 1);
            });
    });

    it('will return the last response if all attempts fail', async (): Promise<void> => {
        mockedFetch.mockResolvedValueOnce(new Response('503', { status: 503 }));
        mockedFetch.mockResolvedValueOnce(new Response('504', { status: 504 }));
        mockedFetch.mockResolvedValueOnce(new Response('419', { status: 419 }));

        const retries = 2;
        const f = builder(mockedFetch, { retries, retryDelay: 0 });

        return expect(f('https://example.test'))
            .resolves.toMatchObject({ status: 419, retryCount: 2 })
            .then((): void => {
                expect(mockedFetch.mock.calls).toHaveLength(retries + 1);
            });
    });

    it('will return the first successful response response if all attempts fail', async (): Promise<void> => {
        mockedFetch.mockRejectedValueOnce(new Error('FAIL'));
        mockedFetch.mockResolvedValueOnce(new Response('503', { status: 503 }));
        mockedFetch.mockResolvedValueOnce(new Response('504', { status: 504 }));
        mockedFetch.mockResolvedValueOnce(new Response('200', { status: 200 }));
        mockedFetch.mockResolvedValueOnce(new Response('419', { status: 419 }));

        const retries = 4;
        const f = builder(mockedFetch, { retries, retryDelay: 0 });

        return expect(f('https://example.test'))
            .resolves.toMatchObject({ status: 200, retryCount: 3 })
            .then((): void => {
                expect(mockedFetch.mock.calls).toHaveLength(4);
            });
    });

    it('returns zero retries on the original response after immediate success', async (): Promise<void> => {
        const response = new Response('ok');
        mockedFetch.mockResolvedValue(response);

        const result = (await builder(mockedFetch)('https://example.test')) as Response & { retryCount: number };
        expect(result).toBe(response);
        expect(result.retryCount).toBe(0);
    });

    it('adds zero retries to the original error when retries are disabled', async (): Promise<void> => {
        const error = new TypeError('failed');
        mockedFetch.mockRejectedValue(error);

        await expect(builder(mockedFetch, { retries: 0 })('https://example.test')).rejects.toBe(error);
        expect(error).toMatchObject({ retryCount: 0 });
    });

    it('normalizes non-Error rejections and records retries', async (): Promise<void> => {
        mockedFetch.mockRejectedValue('failed');

        await expect(builder(mockedFetch, { retries: 1, retryDelay: 0 })('https://example.test')).rejects.toMatchObject(
            {
                message: 'failed',
                retryCount: 1,
            },
        );
    });

    it('rejects callback errors without retrying them', async (): Promise<void> => {
        const error = new Error('callback failed');
        mockedFetch.mockResolvedValue(new Response('ok'));
        const retryOn = jest.fn((): boolean => {
            throw error;
        });

        await expect(builder(mockedFetch, { retryOn })('https://example.test')).rejects.toBe(error);
        expect(mockedFetch).toHaveBeenCalledTimes(1);
        expect(retryOn).toHaveBeenCalledTimes(1);
    });

    it('rejects errors thrown by the delay callback', async (): Promise<void> => {
        const error = new Error('delay failed');
        mockedFetch.mockResolvedValue(new Response('retry', { status: 503 }));
        const retryDelay = (): number => {
            throw error;
        };

        await expect(builder(mockedFetch, { retryDelay })('https://example.test')).rejects.toBe(error);
        expect(mockedFetch).toHaveBeenCalledTimes(1);
    });

    it('retains the custom fetch response type', async (): Promise<void> => {
        const customFetch = (_input: string): Promise<Response & { custom: string }> =>
            Promise.resolve(Object.assign(new Response('ok'), { custom: 'value' }));
        const result = await builder(customFetch)('https://example.test');
        const custom: string = result.custom;
        const count: number = result.retryCount;
        expect([custom, count]).toEqual(['value', 0]);
    });

    it('should prefer init to defaults', async (): Promise<void> => {
        const delayFn = jest.fn((): number => 0);
        const retryFn = jest.fn((): boolean => false);

        const f = builder(mockedFetch, { retries: 1, retryDelay: delayFn, retryOn: retryFn });

        mockedFetch.mockResolvedValueOnce(new Response('503', { status: 503 }));
        mockedFetch.mockResolvedValueOnce(new Response('504', { status: 504 }));
        mockedFetch.mockResolvedValueOnce(new Response('419', { status: 419 }));
        return expect(f('https://example.test', { retries: 2, retryDelay: 0, retryOn: [419, 503, 504] }))
            .resolves.toMatchObject({ status: 419 })
            .then((): void => {
                expect(mockedFetch.mock.calls).toHaveLength(3);
                expect(delayFn.mock.calls).toHaveLength(0);
                expect(retryFn.mock.calls).toHaveLength(0);
            });
    });

    it('should call retry functions', async (): Promise<void> => {
        const delayFn = jest.fn((): number => 0);
        const retryFn = jest.fn();

        retryFn.mockReturnValueOnce(true);
        retryFn.mockReturnValueOnce(false);

        const f = builder(mockedFetch);

        mockedFetch.mockResolvedValueOnce(new Response('503', { status: 503 }));
        mockedFetch.mockResolvedValueOnce(new Response('504', { status: 504 }));
        mockedFetch.mockResolvedValueOnce(new Response('419', { status: 419 }));
        mockedFetch.mockResolvedValueOnce(new Response('200', { status: 200 }));

        return expect(f('https://example.test', { retries: 3, retryDelay: delayFn, retryOn: retryFn }))
            .resolves.toMatchObject({ status: 504, retryCount: 1 })
            .then((): void => {
                expect(mockedFetch.mock.calls).toHaveLength(2);
                expect(retryFn.mock.calls).toHaveLength(2);
                expect(delayFn.mock.calls).toHaveLength(2 - 1);
            });
    });
});

describe('abort signals', (): void => {
    beforeEach((): void => {
        jest.resetAllMocks();
    });

    it('does not start an already aborted request', async (): Promise<void> => {
        const controller = new AbortController();
        const reason = new Error('cancelled');
        controller.abort(reason);
        const retryOn = jest.fn((): boolean => true);

        await expect(builder(mockedFetch, { retryOn })('url', { signal: controller.signal })).rejects.toBe(reason);
        expect(mockedFetch).not.toHaveBeenCalled();
        expect(retryOn).not.toHaveBeenCalled();
    });

    it('uses an AbortError when an older signal has no reason', async (): Promise<void> => {
        const signal = { aborted: true } as AbortSignal;
        await expect(builder(mockedFetch)('url', { signal })).rejects.toMatchObject({ name: 'AbortError' });
        expect(mockedFetch).not.toHaveBeenCalled();
    });

    it('aborts an in-flight request even if fetch does not react to the signal', async (): Promise<void> => {
        const controller = new AbortController();
        const reason = new Error('cancelled');
        mockedFetch.mockImplementation((): Promise<never> => new Promise(jest.fn()));
        const retryOn = jest.fn((): boolean => true);
        const pending = builder(mockedFetch, { retryOn })('url', { signal: controller.signal });
        controller.abort(reason);

        await expect(pending).rejects.toBe(reason);
        expect(mockedFetch).toHaveBeenCalledTimes(1);
        expect(retryOn).not.toHaveBeenCalled();
    });

    it('handles an abort triggered synchronously by fetch', async (): Promise<void> => {
        const controller = new AbortController();
        mockedFetch.mockImplementation((): Promise<never> => {
            controller.abort('cancelled');
            return Promise.reject(new Error('fetch failed'));
        });
        await expect(builder(mockedFetch)('url', { signal: controller.signal })).rejects.toBe('cancelled');
        expect(mockedFetch).toHaveBeenCalledTimes(1);
    });

    it('cancels a retry delay and clears its timer', async (): Promise<void> => {
        jest.useFakeTimers();
        try {
            const controller = new AbortController();
            mockedFetch.mockResolvedValue(new Response('retry', { status: 503 }));
            const delay = jest.fn((): number => 10000);
            const pending = builder(mockedFetch, { retryDelay: delay })('url', { signal: controller.signal });
            await jest.advanceTimersByTimeAsync(0);
            expect(delay).toHaveBeenCalledTimes(1);
            expect(jest.getTimerCount()).toBe(1);
            controller.abort('cancelled');
            await expect(pending).rejects.toBe('cancelled');
            expect(jest.getTimerCount()).toBe(0);
            expect(mockedFetch).toHaveBeenCalledTimes(1);
        } finally {
            jest.useRealTimers();
        }
    });

    it('uses the request signal unless an init signal overrides it', async (): Promise<void> => {
        const controller = new AbortController();
        controller.abort('request aborted');
        const request = { signal: controller.signal };
        mockedFetch.mockResolvedValue(new Response('ok'));
        const wrapped = builder(mockedFetch);

        await expect(wrapped(request)).rejects.toBe('request aborted');
        await expect(wrapped(request, { signal: new AbortController().signal })).resolves.toMatchObject({
            status: 200,
        });
        await expect(wrapped(request, { signal: null })).resolves.toMatchObject({ status: 200 });
        expect(mockedFetch).toHaveBeenCalledTimes(2);
    });

    it('removes the abort listener after a completed request', async (): Promise<void> => {
        const controller = new AbortController();
        const addListener = jest.spyOn(controller.signal, 'addEventListener');
        const removeListener = jest.spyOn(controller.signal, 'removeEventListener');
        mockedFetch.mockResolvedValue(new Response('ok'));

        await builder(mockedFetch)('url', { signal: controller.signal });
        expect(addListener).toHaveBeenCalledTimes(1);
        expect(removeListener).toHaveBeenCalledWith('abort', addListener.mock.calls[0][1]);
    });

    it('does not retry an abort triggered inside retryOn', async (): Promise<void> => {
        const controller = new AbortController();
        mockedFetch.mockResolvedValue(new Response('ok'));
        const retryOn = (): boolean => {
            controller.abort('cancelled');
            return false;
        };
        await expect(builder(mockedFetch, { retryOn })('url', { signal: controller.signal })).rejects.toBe('cancelled');
        expect(mockedFetch).toHaveBeenCalledTimes(1);
    });
});
