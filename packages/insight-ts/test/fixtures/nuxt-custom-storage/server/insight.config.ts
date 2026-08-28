import { defineProvider } from '../../../../src/core/provider.ts'
import { defineNuxtInsightConfig } from '../../../../src/integrations/nuxt/index.ts'

export default defineNuxtInsightConfig({
    providers: [
        defineProvider({
            id: 'app',
            reports: {
                usage: {
                    history: { grain: 'day', mode: 'range' },
                    metrics: {
                        views: { aggregation: 'sum', rollup: 'additive', valueType: 'integer' },
                    },
                    async series() {
                        return { points: [] }
                    },
                },
            },
        }),
    ],
})
