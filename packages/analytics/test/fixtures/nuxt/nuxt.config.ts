import { defineNuxtConfig } from 'nuxt/config'

import analytics from '../../../src/nuxt'

export default defineNuxtConfig({
    modules: [analytics],
    analytics: {
        events: {
            pageViewed: { properties: { path: 'string' } },
        },
        name: 'nuxt-fixture',
        providers: {
            cloudflare: {
                analyticsEngine: 'ANALYTICS',
                r2: 'ANALYTICS_ARCHIVE',
                webAnalytics: 'fixture-site-tag',
            },
            searchConsole: 'sc-domain:example.com',
        },
    },
})
