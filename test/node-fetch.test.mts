import { ok, rejects, strictEqual } from 'node:assert/strict';
import { createServer } from 'node:http';
import { test } from 'node:test';
import fetch3 from 'node-fetch';
import fetch2 from 'node-fetch-v2';
import { fetchBuilder } from '../src/index.mjs';

for (const [version, fetch] of [
    ['2', fetch2],
    ['3', fetch3],
    ['native', globalThis.fetch],
] as const) {
    test(`retries a node-fetch ${version} request`, async () => {
        let requests = 0;
        const server = createServer((_request, response) => {
            requests += 1;
            response.writeHead(requests === 1 ? 503 : 200);
            response.end(requests === 1 ? 'retry' : 'success');
        });

        await new Promise<void>((resolve): void => {
            server.listen(0, '127.0.0.1', resolve);
        });
        try {
            const wrapped = fetchBuilder(fetch, { retries: 1, retryDelay: 0 });
            const address = server.address();
            ok(address && typeof address !== 'string');
            const response = await wrapped(`http://127.0.0.1:${address.port}/`);
            strictEqual(response.status, 200);
            strictEqual(await response.text(), 'success');
            strictEqual(requests, 2);
        } finally {
            await new Promise<void>((resolve, reject): void => {
                server.close((error) => (error ? reject(error) : resolve()));
            });
        }
    });

    test(`aborts an in-flight ${version} request without retrying`, async () => {
        const controller = new AbortController();
        const reason = new Error('cancelled');
        let requests = 0;
        const server = createServer(() => {
            requests += 1;
            controller.abort(reason);
        });
        await new Promise<void>((resolve): void => {
            server.listen(0, '127.0.0.1', resolve);
        });
        try {
            const retryOn = (): never => {
                throw new Error('aborted requests must not be retried');
            };
            const wrapped = fetchBuilder(fetch, { retryOn });
            const address = server.address();
            ok(address && typeof address !== 'string');
            await rejects(
                wrapped(`http://127.0.0.1:${address.port}/`, { signal: controller.signal }),
                (error) => error === reason,
            );
            strictEqual(requests, 1);
        } finally {
            server.closeAllConnections();
            await new Promise<void>((resolve, reject): void => {
                server.close((error) => (error ? reject(error) : resolve()));
            });
        }
    });
}
