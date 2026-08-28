import { defineConfig } from 'tsdown'
import Vue from 'unplugin-vue/rolldown'

export default defineConfig({
    attw: {
        excludeEntrypoints: ['./vue/ui/style.css'],
        level: 'error',
        profile: 'esm-only',
    },
    clean: true,
    copy: [{ from: 'src/style.css', to: 'dist/vue/ui' }],
    css: { inject: true },
    deps: {
        onlyImport: [
            '@tanstack/charts',
            'd3-shape',
            'h3',
            'node:fs',
            'node:path',
            'node:url',
            'nuxt',
            'unstorage',
            'vue',
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
        presentation: 'src/presentation.ts',
        provider: 'src/provider.ts',
        vue: 'src/vue.ts',
        'vue-ui': 'src/vue-ui-entry.ts',
    },
    exports: false,
    format: ['esm'],
    platform: 'neutral',
    plugins: [Vue({ isProduction: true })],
    publint: true,
    sourcemap: true,
})
