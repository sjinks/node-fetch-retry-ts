const merge = require('merge');
const ts_preset = require('ts-jest/jest-preset');

module.exports = merge.recursive(ts_preset, {
    testPathIgnorePatterns: [
        '<rootDir>/dist/',
        '<rootDir>/node_modules/',
        '<rootDir>/test/node-fetch.test.mjs',
    ],
    collectCoverageFrom: [
        '<rootDir>/src/*.ts',
    ],
});
