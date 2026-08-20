import { defineConfig } from 'oxfmt'

export default defineConfig({
    ignorePatterns: [
        '**/.nuxt/**',
        '**/.output/**',
        '**/coverage/**',
        '**/dist/**',
        '**/node_modules/**',
    ],
    printWidth: 100,
    semi: false,
    singleQuote: true,
    sortImports: true,
    sortPackageJson: true,
    tabWidth: 4,
    trailingComma: 'all',
})
