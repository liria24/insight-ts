import { defineNuxtConfig } from 'nuxt/config'

import analytics from '../../../src/nuxt'

export default defineNuxtConfig({
    modules: [analytics],
    analytics: {
        name: 'read-only',
        providers: {
            cloudflare: { webAnalytics: 'site-tag' },
            googleSearchConsole: 'sc-domain:example.com',
        },
        ui: { styles: false },
    },
})
