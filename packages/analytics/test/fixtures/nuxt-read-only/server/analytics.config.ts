import { defineNuxtAnalyticsConfig } from '../../../../src/nuxt-runtime'
import { defineAnalyticsProvider } from '../../../../src/provider'

export default defineNuxtAnalyticsConfig({
    customProviders: ({ event }) => [
        defineAnalyticsProvider({
            id: event ? 'request-provider' : 'server-provider',
            sources: [],
        }),
    ],
    providers: {
        googleSearchConsole: {
            async getAccessToken() {
                return 'fixture-token'
            },
        },
    },
})
