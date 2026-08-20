import { defineNuxtAnalyticsConfig } from '../../../../src/nuxt-runtime'

export default defineNuxtAnalyticsConfig({
    cloudflare: {
        accountId: 'fixture-account',
        apiToken: 'fixture-token',
        bindings: {
            ANALYTICS: {
                writeDataPoint() {},
            },
        },
    },
    async eventHandler() {},
    async getAccessToken() {
        return 'fixture-access-token'
    },
})
