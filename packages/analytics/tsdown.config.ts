import { defineConfig } from 'tsdown'

export default defineConfig({
    attw: {
        level: 'error',
        profile: 'esm-only',
    },
    clean: true,
    deps: {
        onlyImport: ['h3', 'node:fs', 'node:path', 'node:url', 'nuxt', 'unstorage', 'vue'],
    },
    dts: true,
    entry: {
        browser: 'src/browser.ts',
        cloudflare: 'src/cloudflare.ts',
        'google-search-console': 'src/google-search-console.ts',
        index: 'src/index.ts',
        nuxt: 'src/nuxt.ts',
        'nuxt-runtime': 'src/nuxt-runtime.ts',
        vue: 'src/vue.ts',
    },
    exports: false,
    format: ['esm'],
    platform: 'neutral',
    publint: true,
    sourcemap: true,
})
