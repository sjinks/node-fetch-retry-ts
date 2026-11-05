import { Response } from 'node-fetch';
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
