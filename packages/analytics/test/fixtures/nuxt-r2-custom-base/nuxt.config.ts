import { defineNuxtConfig } from 'nuxt/config'

import analytics from '../../../src/nuxt'

export default defineNuxtConfig({
    modules: [analytics],
    analytics: {
        archive: { base: 'my-archive', retention: '1y' },
        name: 'r2-custom-base',
        providers: { cloudflare: { r2: 'ANALYTICS_ARCHIVE' } },
    },
})
