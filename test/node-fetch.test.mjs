import { rejects, strictEqual } from 'node:assert';
import { createServer } from 'node:http';
import { test } from 'node:test';
import fetch3 from 'node-fetch';
import fetch2 from 'node-fetch-v2';
import plugin from '../dist/index.js';

for (const [version, fetch] of [
    ['2', fetch2],
    ['3', fetch3],
    ['native', globalThis.fetch],
]) {
    test(`retries a node-fetch ${version} request`, async () => {
        let requests = 0;
        const server = createServer((_request, response) => {
            requests += 1;
            response.writeHead(requests === 1 ? 503 : 200);
            response.end(requests === 1 ? 'retry' : 'success');
        });
        await new Promise((resolve) => server.listen(0, '127.0.0.1', resolve));
        try {
            const wrapped = plugin.default(fetch, { retries: 1, retryDelay: 0 });
            const response = await wrapped(`http://127.0.0.1:${server.address().port}/`);
            strictEqual(response.status, 200);
            strictEqual(await response.text(), 'success');
            strictEqual(requests, 2);
        } finally {
            await new Promise((resolve, reject) => server.close((error) => (error ? reject(error) : resolve())));
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
        await new Promise((resolve) => server.listen(0, '127.0.0.1', resolve));
        try {
            const retryOn = () => {
                throw new Error('aborted requests must not be retried');
            };
            const wrapped = plugin.default(fetch, { retryOn });
            await rejects(
                wrapped(`http://127.0.0.1:${server.address().port}/`, { signal: controller.signal }),
                (error) => error === reason,
            );
            strictEqual(requests, 1);
        } finally {
            server.closeAllConnections();
            await new Promise((resolve, reject) => server.close((error) => (error ? reject(error) : resolve())));
        }
    });
}
