import { defineNuxtConfig } from 'nuxt/config'
import type { NuxtConfig } from 'nuxt/schema'

import analytics from '../../../src/nuxt'

const config: NuxtConfig & {
    nitro: { storage: { 'analytics:archive': { driver: string } } }
} = {
    modules: [analytics],
    analytics: {
        name: 'existing-storage',
        providers: { cloudflare: { r2: 'ANALYTICS_ARCHIVE' } },
    },
    nitro: {
        storage: {
            'analytics:archive': { driver: 'memory' },
        },
    },
}

export default defineNuxtConfig(config)
