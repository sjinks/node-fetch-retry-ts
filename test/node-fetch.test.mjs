import { strictEqual } from 'node:assert';
import { test } from 'node:test';
import fetch from 'node-fetch';
import plugin from '../dist/index.js';

test('wraps an ESM node-fetch request', async () => {
    const wrapped = plugin.default(fetch, { retries: 0 });
    const response = await wrapped('data:text/plain,hello');
    strictEqual(await response.text(), 'hello');
});
