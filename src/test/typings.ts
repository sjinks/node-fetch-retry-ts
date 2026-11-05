import isofetch from 'isomorphic-fetch';
import nfetch from 'node-fetch';
import nfetch2 from 'node-fetch-v2';
import cfetch from 'cross-fetch';
import builder from '../';

builder(isofetch);
builder(nfetch);
builder(nfetch2);
builder(cfetch);
builder(fetch);

void builder(fetch, {
    retries: 0,
    retryDelay: (): number => 0,
    retryOn: (): boolean => false,
})('https://example.com', { headers: {}, retries: 1 });
