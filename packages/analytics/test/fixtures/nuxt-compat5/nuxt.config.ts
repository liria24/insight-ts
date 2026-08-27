import { defineNuxtConfig } from 'nuxt/config'

import analytics from '../../../src/nuxt'

export default defineNuxtConfig({
    modules: [analytics],
    analytics: { name: 'compat5', ui: { styles: true } },
    future: { compatibilityVersion: 5 },
})
