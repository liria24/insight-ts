export default defineNuxtConfig({
    extends: ['docus'],
    modules: ['@liria24/analytics/nuxt'],
    analytics: {
        name: 'docs',
    },
    css: ['vue-data-ui/style.css'],
    llms: {
        domain: 'https://analytics.liria.me',
    },
    mcp: {
        enabled: false,
    },
    nitro: {
        preset: 'cloudflare_module',
    },
    ogImage: {
        enabled: false,
    },
})
