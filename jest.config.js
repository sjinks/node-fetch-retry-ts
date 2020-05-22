const merge = require('merge');
const ts_preset = require('ts-jest/jest-preset');

module.exports = merge.recursive(ts_preset, {
    globals: {
        'ts-jest': {
            packageJson: 'package.json',
        },
    }
});
