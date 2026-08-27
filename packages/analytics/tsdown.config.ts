import { defineConfig } from 'tsdown'
import Vue from 'unplugin-vue/rolldown'

export default defineConfig({
    attw: {
        excludeEntrypoints: ['./vue/style.css'],
        level: 'error',
        profile: 'esm-only',
    },
    clean: true,
    copy: [{ from: 'src/style.css', to: 'dist/vue' }],
    deps: {
        onlyImport: [
            'h3',
            'node:fs',
            'node:path',
            'node:url',
            'nuxt',
            'unstorage',
            'vue',
            'vue-data-ui',
            'vue-data-ui/vue-ui-xy',
        ],
    },
    dts: {
        vue: true,
    },
    entry: {
        browser: 'src/browser.ts',
        cloudflare: 'src/cloudflare.ts',
        'google-search-console': 'src/google-search-console.ts',
        index: 'src/index.ts',
        nuxt: 'src/nuxt.ts',
        'nuxt-runtime': 'src/nuxt-runtime.ts',
        provider: 'src/provider.ts',
        vue: 'src/vue.ts',
    },
    exports: false,
    format: ['esm'],
    platform: 'neutral',
    plugins: [Vue({ isProduction: true })],
    publint: true,
    sourcemap: true,
})
