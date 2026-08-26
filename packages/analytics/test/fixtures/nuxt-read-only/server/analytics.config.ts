import { defineNuxtAnalyticsConfig } from '../../../../src/nuxt-runtime'

export default defineNuxtAnalyticsConfig({
    auth: {
        searchConsole: {
            async getAccessToken() {
                return 'fixture-token'
            },
        },
    },
})
