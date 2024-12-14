// eslint-disable-next-line import/no-unresolved
import isofetch from 'isomorphic-fetch';
import nfetch from 'node-fetch';
import cfetch from 'cross-fetch';
import builder from '../';

builder(isofetch);
builder(nfetch);
builder(cfetch);
builder(fetch);

void builder(fetch, {
    retries: 0,
    retryDelay: (): number => 0,
    retryOn: (): boolean => false,
})('https://example.com', { headers: {}, retries: 1 });
