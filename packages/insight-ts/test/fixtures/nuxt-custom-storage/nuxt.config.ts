import { defineNuxtConfig } from 'nuxt/config'
import type { NuxtConfig } from 'nuxt/schema'

import insight from '../../../src/integrations/nuxt/index.ts'

const config: NuxtConfig & { nitro: { storage: { insight: { driver: string } } } } = {
    modules: [insight],
    insight: { history: { sources: ['app.usage'] } },
    nitro: { storage: { insight: { driver: 'memory' } } },
}

export default defineNuxtConfig(config)
