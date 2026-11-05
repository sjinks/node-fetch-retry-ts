import MyrotvoretsConfig from '@myrotvorets/eslint-config-myrotvorets-ts';
import globals from 'globals';

/** @type {import('eslint').Linter.Config[]} */
export default [
    {
        ignores: ['**/*.js', '**/*.d.ts', '.test-build/**', 'dist/**', 'example/**'],
    },
    ...MyrotvoretsConfig,
    {
        files: ['test/**/*.mts'],
        rules: {
            '@typescript-eslint/no-floating-promises': 'off',
            '@typescript-eslint/require-await': 'off',
        },
    },
    {
        languageOptions: {
            globals: {
                ...globals.node,
            },
        },
    },
];
