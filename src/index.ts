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
export default function<F extends (...args: any) => Promise<any> = typeof fetch>(
    fetchFunc: F,
    params: FetchRetryParams = {},
): (input: Parameters<F>[0], init?: Parameters<F>[1] & FetchRetryParams) => ReturnType<F> {
    const defaults = sanitize(params, { retries: 3, retryDelay: 500, retryOn: [419, 503, 504] });

    return function(input: Parameters<F>[0], init?: Parameters<F>[1] & FetchRetryParams): Promise<Response> {
        const frp = sanitize(
            {
                retries: init?.retries,
                retryDelay: init?.retryDelay,
                retryOn: init?.retryOn,
            },
            defaults,
        );

        const retryDelayFn =
            typeof frp.retryDelay === 'function' ? frp.retryDelay : (): number => frp.retryDelay as number;

        const retryOnFn =
            typeof frp.retryOn === 'function'
                ? frp.retryOn
                : (attempt: number, retries: number, error: Error | null, response: Response | null): boolean =>
                      (!!error || !response || (frp.retryOn as number[]).indexOf(response.status) !== -1) &&
                      attempt < retries;

        return new Promise<Response>(function(resolve, reject): void {
            const extendedFetch = function(attempt: number): void {
                fetchFunc(input, init)
                    .then(function(response: Response): void {
                        if (retryOnFn(attempt, frp.retries, null, response)) {
                            // eslint-disable-next-line @typescript-eslint/no-use-before-define
                            retry(attempt, null, response);
                        } else {
                            resolve(response);
                        }
                    })
                    .catch(function(error: Error): void {
                        if (retryOnFn(attempt, frp.retries, error, null)) {
                            // eslint-disable-next-line @typescript-eslint/no-use-before-define
                            retry(attempt, error, null);
                        } else {
                            reject(error);
                        }
                    });
            };

            function retry(attempt: number, error: Error | null, response: Response | null): void {
                setTimeout(function(): void {
                    extendedFetch(++attempt);
                }, retryDelayFn(attempt, error, response));
            }

            extendedFetch(0);
        });
    };
}
