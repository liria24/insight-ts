import { defineNuxtConfig } from 'nuxt/config'
import type { NuxtConfig } from 'nuxt/schema'

import analytics from '../../../src/nuxt'

const config: NuxtConfig & {
    nitro: { storage: { 'custom:archive': { driver: string } } }
} = {
    modules: [analytics],
    analytics: {
        archive: { base: 'custom:archive' },
        name: 'custom-storage',
    },
    nitro: {
        storage: {
            'custom:archive': { driver: 'memory' },
        },
    },
}

export default defineNuxtConfig(config)
