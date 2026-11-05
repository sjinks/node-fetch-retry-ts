export type RequestDelayFunction = (attempt: number, error: Error | null, response: Response | null) => number;
export type RetryRequestFunction = (
    attempt: number,
    retries: number,
    error: Error | null,
    response: Response | null,
) => boolean;

export interface FetchRetryParams {
    retries?: number;
    retryDelay?: number | RequestDelayFunction;
    retryOn?: number[] | RetryRequestFunction;
}

/** The number of retries performed after the initial request. */
export interface RetryCount {
    retryCount: number;
}

function sanitize(params: FetchRetryParams, defaults: Required<FetchRetryParams>): Required<FetchRetryParams> {
    const result = { ...defaults, ...params };
    if (typeof result.retries === 'undefined') {
        result.retries = defaults.retries;
    }

    if (typeof result.retryDelay === 'undefined') {
        result.retryDelay = defaults.retryDelay;
    }

    if (typeof result.retryOn === 'undefined') {
        result.retryOn = defaults.retryOn;
    }

    return result;
}

function getSignal(input: unknown, init: unknown): AbortSignal | null | undefined {
    const initSignal = (init as { signal?: AbortSignal | null } | undefined)?.signal;
    if (initSignal !== undefined) {
        return initSignal;
    }

    return typeof input === 'object' && input !== null && 'signal' in input
        ? (input as { signal?: AbortSignal | null }).signal
        : undefined;
}

function abortReason(signal: AbortSignal): unknown {
    if (signal.reason !== undefined) {
        return signal.reason;
    }

    const error = new Error('The operation was aborted');
    error.name = 'AbortError';
    return error;
}

async function abortable<T>(promise: Promise<T>, signal: AbortSignal | null | undefined): Promise<T> {
    if (!signal) {
        return promise;
    }

    if (signal.aborted) {
        // Observe a promise that may already have rejected.
        void promise.catch((): undefined => undefined);
        throw abortReason(signal);
    }

    let onAbort!: () => void;
    const aborted = new Promise<never>((_resolve, reject): void => {
        // AbortSignal reasons can be any JavaScript value.
        // eslint-disable-next-line @typescript-eslint/prefer-promise-reject-errors
        onAbort = (): void => reject(abortReason(signal));
        signal.addEventListener('abort', onAbort, { once: true });
    });
    try {
        return await Promise.race([promise, aborted]);
    } finally {
        signal.removeEventListener('abort', onAbort);
    }
}

// eslint-disable-next-line @typescript-eslint/no-explicit-any
export function fetchBuilder<F extends (...args: any) => Promise<any> = typeof fetch>(
    fetchFunc: F,
    params: FetchRetryParams = {},
): (
    input: Parameters<F>[0],
    init?: Parameters<F>[1] & FetchRetryParams,
) => Promise<Awaited<ReturnType<F>> & RetryCount> {
    const defaults = sanitize(params, { retries: 3, retryDelay: 500, retryOn: [419, 503, 504] });

    // The retry loop keeps attempt handling and callback behavior together.
    // eslint-disable-next-line sonarjs/cognitive-complexity
    return async function (
        input: Parameters<F>[0],
        init?: Parameters<F>[1] & FetchRetryParams,
    ): Promise<Awaited<ReturnType<F>> & RetryCount> {
        const frp = sanitize(
            {
                // eslint-disable-next-line @typescript-eslint/no-unsafe-assignment
                retries: init?.retries,
                // eslint-disable-next-line @typescript-eslint/no-unsafe-assignment
                retryDelay: init?.retryDelay,
                // eslint-disable-next-line @typescript-eslint/no-unsafe-assignment
                retryOn: init?.retryOn,
            } satisfies FetchRetryParams,
            defaults,
        );

        const retryDelayFn =
            typeof frp.retryDelay === 'function' ? frp.retryDelay : (): number => frp.retryDelay as number;

        const retryOnFn =
            typeof frp.retryOn === 'function'
                ? frp.retryOn
                : (attempt: number, retries: number, error: Error | null, response: Response | null): boolean =>
                      (!!error || !response || (frp.retryOn as number[]).includes(response.status)) &&
                      attempt < retries;

        const signal = getSignal(input, init);

        for (let attempt = 0; ; ++attempt) {
            if (signal?.aborted) {
                throw abortReason(signal);
            }
            let response: Awaited<ReturnType<F>> | null = null;
            let error: Error | null = null;
            try {
                // Each attempt must finish before deciding whether to retry.
                // eslint-disable-next-line @typescript-eslint/no-unsafe-assignment, no-await-in-loop
                response = await abortable(fetchFunc(input, init), signal);
            } catch (cause: unknown) {
                if (signal?.aborted) {
                    throw abortReason(signal);
                }
                error = cause instanceof Error ? cause : new Error(String(cause));
            }

            const shouldRetry = retryOnFn(attempt, frp.retries, error, response);
            if (signal?.aborted) {
                throw abortReason(signal);
            }
            if (!shouldRetry) {
                if (error) {
                    Object.assign(error, { retryCount: attempt });
                    throw error;
                }

                return Object.assign(response!, { retryCount: attempt });
            }

            // Wait for the configured delay before starting the next attempt.
            const delay = retryDelayFn(attempt, error, response);
            let timer: ReturnType<typeof setTimeout> | undefined;
            try {
                // eslint-disable-next-line no-await-in-loop
                await abortable(
                    new Promise<void>((resolve): void => {
                        timer = setTimeout(resolve, delay);
                    }),
                    signal,
                );
            } finally {
                clearTimeout(timer);
            }
        }
    };
}

export default fetchBuilder;
