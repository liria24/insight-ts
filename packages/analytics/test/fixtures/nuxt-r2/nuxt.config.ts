import { defineNuxtConfig } from 'nuxt/config'

import analytics from '../../../src/nuxt'

export default defineNuxtConfig({
    modules: [analytics],
    analytics: {
        archive: { retention: '1y' },
        name: 'r2',
        providers: { cloudflare: { r2: 'ANALYTICS_ARCHIVE' } },
    },
})
