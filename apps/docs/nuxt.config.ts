export default defineNuxtConfig({
    extends: ['docus'],
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
