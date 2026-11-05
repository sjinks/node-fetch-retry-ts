import { strictEqual } from 'node:assert';
import { createServer } from 'node:http';
import { test } from 'node:test';
import fetch3 from 'node-fetch';
import fetch2 from 'node-fetch-v2';
import plugin from '../dist/index.js';

for (const [version, fetch] of [
    ['2', fetch2],
    ['3', fetch3],
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
}
