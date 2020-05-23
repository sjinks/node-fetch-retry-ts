import isofetch from 'isomorphic-fetch';
import nfetch from 'node-fetch';
import unfetch from 'unfetch';
import iunfetch from 'isomorphic-unfetch';
import cfetch from 'cross-fetch';
import builder from '../';

builder(isofetch);
builder(nfetch);
builder(unfetch);
builder(iunfetch);
builder(cfetch);
builder(fetch);

builder(fetch, {
    retries: 0,
    retryDelay: (): number => 0,
    retryOn: (): boolean => false,
})('https://example.com', { headers: {}, retries: 1 });
