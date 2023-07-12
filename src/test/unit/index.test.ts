import { Response, type RequestInfo, type RequestInit } from 'node-fetch';
import builder from '../../';

const mockedFetch = jest.fn<Promise<Response>, [RequestInfo, RequestInit | undefined]>();

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
                expect(mockedFetch.mock.calls.length).toBe(1);
            });
    });
});

describe('fetch retry', (): void => {
    beforeEach((): void => {
        jest.resetAllMocks();
        jest.useRealTimers();
    });

    it('passes input parameter to fetch()', async (): Promise<void> => {
        const expectedParam = 'https://example.test';
        const expectedResponse = new Response('r');

        mockedFetch.mockResolvedValue(expectedResponse);
        const f = builder(mockedFetch);

        return expect(f(expectedParam))
            .resolves.toEqual(expectedResponse)
            .then((): void => {
                expect(mockedFetch).toBeCalledWith(expectedParam, { signal: expect.any(AbortSignal) });
            });
    });

    it('is called only once on success (with default params)', async (): Promise<void> => {
        const expectedResponse = new Response('r');

        mockedFetch.mockResolvedValue(expectedResponse);
        const f = builder(mockedFetch);

        return expect(f('https://example.test'))
            .resolves.toEqual(expectedResponse)
            .then((): void => {
                expect(mockedFetch.mock.calls.length).toBe(1);
            });
    });

    it('will reject if all attempts fail', async (): Promise<void> => {
        const expectedResponse = 'FAIL';
        mockedFetch.mockRejectedValue(new Error(expectedResponse));

        const retries = 3;
        const f = builder(mockedFetch, { retries, retryDelay: 0 });

        return expect(f('https://example.test'))
            .rejects.toMatchObject({ message: expectedResponse })
            .then((): void => {
                expect(mockedFetch.mock.calls.length).toBe(retries + 1);
            });
    });

    it('will return the last response if all attempts fail', async (): Promise<void> => {
        mockedFetch.mockResolvedValueOnce(new Response('503', { status: 503 }));
        mockedFetch.mockResolvedValueOnce(new Response('504', { status: 504 }));
        mockedFetch.mockResolvedValueOnce(new Response('419', { status: 419 }));

        const retries = 2;
        const f = builder(mockedFetch, { retries, retryDelay: 0 });

        return expect(f('https://example.test'))
            .resolves.toMatchObject({ status: 419 })
            .then((): void => {
                expect(mockedFetch.mock.calls.length).toBe(retries + 1);
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
            .resolves.toMatchObject({ status: 200 })
            .then((): void => {
                expect(mockedFetch.mock.calls.length).toBe(4);
            });
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
                expect(mockedFetch.mock.calls.length).toBe(3);
                expect(delayFn.mock.calls.length).toBe(0);
                expect(retryFn.mock.calls.length).toBe(0);
            });
    });

    it('should call retry functions', async (): Promise<void> => {
        jest.useFakeTimers();
        const delayFn = jest.fn((): number => 20);
        const retryFn = jest.fn();

        retryFn.mockReturnValueOnce(true);
        retryFn.mockReturnValueOnce(false);

        const f = builder(mockedFetch);

        mockedFetch.mockResolvedValueOnce(new Response('503', { status: 503 }));
        mockedFetch.mockResolvedValueOnce(new Response('504', { status: 504 }));
        mockedFetch.mockResolvedValueOnce(new Response('419', { status: 419 }));
        mockedFetch.mockResolvedValueOnce(new Response('200', { status: 200 }));

        const promise = f('https://example.test', { retries: 3, retryDelay: delayFn, retryOn: retryFn });
        await jest.runAllTimersAsync();
        const response = await promise;

        expect(response).toMatchObject({ status: 504 });
        expect(mockedFetch.mock.calls.length).toBe(2);
        expect(retryFn.mock.calls.length).toBe(2);
        expect(delayFn.mock.calls.length).toBe(2 - 1);
    });

    it('should timeout before the server answers when timeout value is configured', async (): Promise<void> => {
        jest.useFakeTimers();
        const retryFn = jest.fn();
        const timeout = 2;
        const callTimes: Date[] = [];

        const f = builder(mockedFetch, { retries: 1, retryDelay: 0, retryOn: retryFn, retryTimeout: timeout * 1000 });

        retryFn.mockReturnValueOnce(true);
        retryFn.mockReturnValueOnce(false);

        mockedFetch.mockImplementation((url, init) => {
            callTimes.push(new Date());
            return new Promise((resolve, reject) => {
                const timer = setTimeout(
                    () => {
                        console.log('resolving');
                        resolve(new Response('503', { status: 503 }));
                    },
                    timeout * 1000 + 500,
                );

                init?.signal?.addEventListener('abort', () => {
                    clearTimeout(timer);
                    reject(new Error('abort'));
                });
            });
        });

        const promise = f('https://example.test');
        await jest.advanceTimersToNextTimerAsync(); // will abort the request here and retry

        const [result] = await Promise.allSettled([promise, jest.advanceTimersToNextTimerAsync()]); // will abort the request for the second time here and will not retry

        expect(result.status).toBe('rejected');
        expect((result as PromiseRejectedResult).reason).toMatchObject({ message: 'abort' });
        expect(mockedFetch.mock.calls.length).toBe(2);
        expect(callTimes.length).toBe(2);
        expect(callTimes[1].getSeconds() - callTimes[0].getSeconds()).toBe(2);
    });
});
