# fetch-retry-ts

[![Build and test](https://github.com/sjinks/node-fetch-retry-ts/actions/workflows/build-test.yml/badge.svg?branch=master)](https://github.com/sjinks/node-fetch-retry-ts/actions/workflows/build-test.yml)
[![CodeQL](https://github.com/sjinks/node-fetch-retry-ts/actions/workflows/codeql-analysis.yml/badge.svg?branch=master)](https://github.com/sjinks/node-fetch-retry-ts/actions/workflows/codeql-analysis.yml)
[![npm version](https://img.shields.io/npm/v/fetch-retry-ts)](https://www.npmjs.com/package/fetch-retry-ts)

Adds retry functionality to `fetch()`.

Wrap a fetch implementation to retry failed requests. The package works with native `fetch` and compatible implementations such as node-fetch 2.x and 3.x.

## Installation

```bash
npm install fetch-retry-ts
```

The package is distributed as an ES module. Use an ESM import as shown below; CommonJS applications can load it with `await import('fetch-retry-ts')`.

## Usage

```typescript
import fetchBuilder from 'fetch-retry-ts';

const options = {
    retries: 3,
    retryDelay: 500,
    retryOn: [419, 503, 504],
};

const fetchWithRetry = fetchBuilder(globalThis.fetch, options);

const response = await fetchWithRetry('https://example.com/');
console.log(response.status, response.retryCount);
```

`fetchBuilder` is available as both a default and a named export. It takes a fetch function and optional retry defaults, and returns a function with the same input and init arguments. Pass the same options in `init` to override the defaults for one request.

| Option | Default | Behavior |
| --- | --- | --- |
| `retries` | `3` | Maximum number of retries after the initial request when `retryOn` is an array. |
| `retryDelay` | `500` | Delay in milliseconds, or `(attempt, error, response) => number`. |
| `retryOn` | `[419, 503, 504]` | Status codes to retry, or `(attempt, retries, error, response) => boolean`. |

With an array, network errors and the listed status codes trigger retries up to the configured limit. A custom `retryOn` decides whether to retry and must enforce the limit itself if desired. Callback `attempt` is zero for the initial request and increases by one for each retry; `retries` is the configured limit. `error` is the error from a failed fetch, or `null`; `response` is the response from a successful fetch, or `null`.

The final response has a `retryCount` property: `0` means the initial request succeeded or was returned without a retry; `1` means one retry was made, and so on. If the request ultimately rejects, the final `Error` also has a `retryCount` property. Existing error instances and their types are preserved; non-`Error` rejections are converted to an `Error`.

The property is added directly to the final response or error, so these objects must be extensible and their `retryCount` property, if present, must be writable. Errors thrown by retry callbacks are propagated separately and do not have a retry count added.

An `AbortSignal` supplied in `init` or on a Request stops the request and any pending retry delay, even with a custom `retryOn` function. An `init.signal` overrides the Request's signal. Cancellation rejects with the signal's reason (or an `AbortError` if the signal has no reason); the reason is passed through unchanged and is not given a `retryCount`. The underlying fetch implementation must support the signal to stop its own network activity.

```typescript
import type { RetryCount } from 'fetch-retry-ts';

try {
    const response = await fetchWithRetry('https://example.com/');
    console.log(response.retryCount);
} catch (error: unknown) {
    if (error instanceof Error && 'retryCount' in error) {
        console.log((error as Error & RetryCount).retryCount);
    }
}
```

## Examples

### Retry on Network Failures and 5xx Responses

```typescript
fetchWithRetry(url, {
    retryOn: (attempt: number, retries: number, error: Error | null, response: Response | null): boolean => (
        attempt < retries && (!!error || !response || (response.status >= 500 && response.status < 600))
    ),
}).then(/* ... */)
```

### Retry only on Network Failures

```typescript
fetchWithRetry(url, {
    retryOn: [],
}).then(/* ... */)
```

### Do not retry on Network Failures

```typescript
fetchWithRetry(url, {
    retryOn: (attempt: number, retries: number, error: Error | null, response: Response | null): boolean => (
        attempt < retries && error === null /* && additional logic to check response code */
    ),
}).then(/* ... */)
```

### Exponential Backoff

```typescript
fetchWithRetry(url, {
    retryDelay: (attempt: number, error: Error | null, response: Response | null): number => (
        Math.pow(2, attempt) * 1000
    ),
}).then(/* ... */)
```

## Development

```bash
npm ci
npm test
npm run build
```

`npm test` runs ESLint and the TypeScript tests with coverage. `npm run build` type-checks the project and emits the package and tests to `dist`.
