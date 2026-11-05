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

        for (let attempt = 0; ; ++attempt) {
            let response: Awaited<ReturnType<F>> | null = null;
            let error: Error | null = null;
            try {
                // Each attempt must finish before deciding whether to retry.
                // eslint-disable-next-line @typescript-eslint/no-unsafe-assignment, no-await-in-loop
                response = await fetchFunc(input, init);
            } catch (cause: unknown) {
                error = cause instanceof Error ? cause : new Error(String(cause));
            }

            if (!retryOnFn(attempt, frp.retries, error, response)) {
                if (error) {
                    Object.assign(error, { retryCount: attempt });
                    throw error;
                }

                return Object.assign(response!, { retryCount: attempt });
            }

            // Wait for the configured delay before starting the next attempt.
            // eslint-disable-next-line no-await-in-loop
            await new Promise<void>((resolve): void => {
                setTimeout(resolve, retryDelayFn(attempt, error, response));
            });
        }
    };
}

export default fetchBuilder;
