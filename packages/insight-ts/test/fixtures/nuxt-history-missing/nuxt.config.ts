import { defineNuxtConfig } from 'nuxt/config'

import insight from '../../../src/integrations/nuxt/index.ts'

export default defineNuxtConfig({
    modules: [insight],
    insight: { history: {} },
})
