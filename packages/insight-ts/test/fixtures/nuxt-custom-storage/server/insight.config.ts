import { defineProvider } from '../../../../src/core/provider.ts'
import { defineNuxtInsightConfig } from '../../../../src/integrations/nuxt/index.ts'
import { defineMetricSource } from '../../../../src/metrics/index.ts'

export default defineNuxtInsightConfig({
    providers: [
        defineProvider({
            id: 'app',
            sources: {
                usage: defineMetricSource({
                    execute: () => ({ points: [], values: { views: 0 } }),
                    history: { grain: 'day' },
                    metrics: {
                        views: { aggregation: { kind: 'sum' }, rollup: 'additive' },
                    },
                }),
            },
        }),
    ],
})
