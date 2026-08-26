import { defineNuxtConfig } from 'nuxt/config'

import analytics from '../../../src/nuxt'

export default defineNuxtConfig({
    modules: [analytics],
    analytics: {
        events: { setupCreated: {} },
        name: 'events-only',
    },
})
