import { withoutProtocol } from 'ufo'

const publicUrl = 'https://analytics.liria.me'

export default defineNuxtConfig({
    future: { compatibilityVersion: 5 },

    extends: ['docus'],

    modules: ['@liria24/analytics/nuxt', '@vueuse/nuxt'],

    analytics: {
        name: 'docs',
        providers: {
            cloudflare: {
                webAnalytics: {
                    host: withoutProtocol(publicUrl),
                    siteTag: process.env.CLOUDFLARE_SITE_TAG,
                },
            },
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
        '/api': { redirect: '/reference/api' },
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
