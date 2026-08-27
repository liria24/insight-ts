const publicUrl = 'https://analytics.liria.me'
const cloudflareSiteTag = process.env.CLOUDFLARE_SITE_TAG

export default defineNuxtConfig({
    extends: ['docus'],

    modules: ['@liria24/analytics/nuxt'],

    analytics: {
        name: 'docs',
        ...(cloudflareSiteTag
            ? {
                  providers: {
                      cloudflare: {
                          webAnalytics: {
                              host: 'analytics.liria.me',
                              siteTag: cloudflareSiteTag,
                          },
                      },
                  },
              }
            : {}),
    },

    nitro: {
        preset: 'cloudflare_module',
        compressPublicAssets: true,
    },

    routeRules: {
        '/api': { redirect: '/reference/api' },
        '/guide': { redirect: '/getting-started/introduction' },
    },

    vite: {
        vue: {
            features: {
                optionsAPI: false,
            },
        },
    },

    llms: {
        domain: 'https://analytics.liria.me',
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
