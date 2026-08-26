import { defineNuxtConfig } from 'nuxt/config'

import analytics from '../../../src/nuxt'

export default defineNuxtConfig({
    modules: [analytics],
    analytics: {
        events: { pageViewed: { properties: { path: 'string' } } },
        name: 'events',
    },
})
