# fetch-retry-ts

![Build and Test CI](https://github.com/sjinks/node-fetch-retry-ts/workflows/Build%20and%20Test%20CI/badge.svg)

Adds retry functionality to `fetch()`.

## Installation

```bash
npm install fetch-retry-ts
```

## Usage

```typescript
import originalFetch from 'isomorphic-fetch';
import fetchBuilder from 'fetch-retry-ts';

const options = {
    retries: 3,
    retryDelay: 1000,
    retryOn: [419, 503, 504],
};

const fetch = fetchBuilder(originalFetch, options);

fetch('https://example.com/').then(/* ... */);
```

`fetch-retry-ts` exports a function, which is used to build the new `fetch()`-compatible function supporting the retry logic.
It accepts two arguments:
  * `fetch` (required): the original `fetch()` function (from `isomorphic-fetch` etc)
  * `defaults` (optional): default values for the retry logic:
    * `retries?: number`: number of attempts to make (3 by default);
    * `retryDelay?: number | () => number | (attempt: number, error: Error | null, response: Response | null) => number`: delay between attempts (in ms). If specified as a function, the function accepts the following parameters:
      * `attempt`: the number of the current attempt;
      * `error`: `Error` object coming from `fetch()` when it rejects on a network failure, or `null`;
      * `response`: `Response` or `null` if `error !== null`
    It should return an integer, which is treated as the delay in ms before the enxt attempt is made. The default value for `retryDelay` is `1000`.
    * `retryOn?: number[] | (attempt: number, retries: number, error: Error | null, response: Response | null) => boolean`: if specified as an array of integers, it is treated as a list of HTTP codes which trigger retry. When specified as a function, that functoin accepts the same parameters as the one described in `retryDelay`, and an additional parameter called `retries`, whcih is the number of configured retries. The function should return a truthy value if the request should be retried. *If `retryOn` is a function, `retries` is ignored.* The default value for `retryOn` in `[429, 503, 504]`.
It returns a function to be used instead of `fetch()`.

The returned function accepts the same arguments as `fetch(input: RequestInfo, init?: RequestInit)`, and three additional properties in `init` object. Those are `retries`, `retryDelay`, and `retryOn`.

## Examples

### Retry on any 5xx Error

```typescript
fetch(url, {
    retryOn: (attempt: number, retries: number, error: Error | null, response: Response | null): boolean => (
        attempt < retries && (!!error || !response || response.status >= 500)
    ),
}).then(/* ... */)
```

### Retry only on Network Failures

```typescript
fetch(url, {
    retryOn: [],
}).then(/* ... */)
```

### Do not retry on Network Failures

```typescript
fetch(url, {
    retryOn: (attempt: number, retries: number, error: Error | null, response: Response | null): boolean => (
        attempt < retries && error === null /* && additional logic to check response code */
    ),
}).then(/* ... */)
```

### Exponential Backoff

```typescript
fetch(url, {
    retryDelay: (attempt: number, error: Error | null, response: Response | null): number => (
        Math.pow(2, attempt) * 1000
    ),
}).then(/* ... */)
```
