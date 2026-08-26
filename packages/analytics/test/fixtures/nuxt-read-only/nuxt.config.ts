import { defineNuxtConfig } from 'nuxt/config'

import analytics from '../../../src/nuxt'

export default defineNuxtConfig({
    modules: [analytics],
    analytics: {
        name: 'read-only',
        providers: {
            cloudflare: { webAnalytics: 'site-tag' },
            searchConsole: 'sc-domain:example.com',
        },
    },
})
