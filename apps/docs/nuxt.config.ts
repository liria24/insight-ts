const publicUrl = 'https://analytics.liria.me'

export default defineNuxtConfig({
    future: { compatibilityVersion: 5 },

    extends: ['docus'],

    modules: ['insight-ts/nuxt', '@vueuse/nuxt'],

    experimental: {
        nitroAutoImports: true,
    },

    insight: {
        providers: {
            cloudflare: { webAnalytics: true },
        },
    },

    runtimeConfig: {
        cloudflare: {
            accountId: '',
            apiToken: '',
            host: 'analytics.liria.me',
            siteTag: '',
        },
    },

    nitro: {
        preset: 'cloudflare_module',
        cloudflare: {
            wrangler: {
                name: 'liria-analytics-docs',
                assets: {
                    binding: 'ASSETS',
                    directory: '.output/public',
                },
                d1_databases: [
                    {
                        binding: 'DB',
                        database_id: 'fd0685ee-5b62-44a6-9a48-593cf36a9f9d',
                        database_name: 'liria-analytics-docs-content',
                    },
                ],
                kv_namespaces: [
                    {
                        binding: 'KV',
                        id: 'b36b3cdf83f2499a890d457214d13553',
                    },
                ],
                observability: {
                    enabled: true,
                },
                routes: [
                    {
                        pattern: 'analytics.liria.me',
                        custom_domain: true,
                    },
                ],
            },
        },
        compressPublicAssets: true,
        storage: {
            cache: {
                driver: 'cloudflare-kv-binding',
                binding: 'KV',
                base: 'cache',
            },
        },
        devStorage: {
            cache: {
                driver: 'null',
            },
        },
    },

    routeRules: {
        '/**': { headers: { 'Cache-Control': 'no-store' } },
        '/api': { redirect: '/reference/api' },
        '/api/demo': {
            headers: { 'Cloudflare-CDN-Cache-Control': 'public, max-age=14400' },
        },
    },

    llms: {
        domain: publicUrl,
    },

    mcp: {
        enabled: false,
    },

    ogImage: {
        enabled: false,
    },

    fonts: {
        families: [
            {
                name: 'Geist',
                provider: 'google',
                preload: true,
                global: true,
                weights: [200, 300, 400, 500, 600, 700],
            },
            {
                name: 'Geist Mono',
                provider: 'google',
                preload: true,
                global: true,
                weights: [200, 400, 600],
            },
        ],
    },

    $production: {
        image: {
            provider: 'cloudflare',
            cloudflare: { baseURL: publicUrl },
        },
    },
})
