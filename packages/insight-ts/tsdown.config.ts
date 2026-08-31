import { defineConfig } from 'tsdown'
import Vue from 'unplugin-vue/rolldown'

export default defineConfig({
    attw: {
        excludeEntrypoints: ['./vue/ui/style.css'],
        level: 'error',
        profile: 'esm-only',
    },
    clean: true,
    copy: [{ from: 'src/integrations/vue/ui/style.css', to: 'dist/vue/ui' }],
    css: { inject: true },
    deps: {
        onlyImport: [
            '@tanstack/charts',
            '@opentelemetry/api',
            'd3-shape',
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
        browser: 'src/integrations/browser/index.ts',
        cloudflare: 'src/providers/cloudflare/index.ts',
        'google-search-console': 'src/providers/google-search-console/index.ts',
        history: 'src/history/index.ts',
        index: 'src/core/index.ts',
        logs: 'src/logs/index.ts',
        metrics: 'src/metrics/index.ts',
        nitro: 'src/integrations/nitro/index.ts',
        nuxt: 'src/integrations/nuxt/index.ts',
        opentelemetry: 'src/integrations/opentelemetry/index.ts',
        traces: 'src/traces/index.ts',
        'ui-core': 'src/ui-core/index.ts',
        vue: 'src/integrations/vue/index.ts',
        'vue-ui': 'src/integrations/vue/ui/index.ts',
    },
    exports: false,
    format: ['esm'],
    platform: 'neutral',
    plugins: [Vue({ isProduction: true })],
    publint: true,
    sourcemap: true,
})
