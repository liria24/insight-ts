import { defineConfig } from 'oxlint'

export default defineConfig({
    categories: {
        correctness: 'error',
        perf: 'warn',
        suspicious: 'error',
    },
    env: {
        browser: true,
        node: true,
    },
    ignorePatterns: ['**/.nuxt/**', '**/.output/**', '**/coverage/**', '**/dist/**'],
    options: {
        typeAware: true,
    },
    plugins: ['import', 'typescript', 'unicorn', 'vitest'],
    rules: {
        'import/no-cycle': 'error',
        'no-console': 'warn',
        'typescript/no-floating-promises': 'error',
    },
    overrides: [
        {
            files: ['**/*.test.ts', '**/*.spec.ts'],
            rules: {
                'typescript/no-explicit-any': 'off',
            },
        },
    ],
})
