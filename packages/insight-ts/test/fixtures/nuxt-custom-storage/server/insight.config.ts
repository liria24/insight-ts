import { defineProvider } from '../../../../src/core/index.ts'
import { defineNuxtInsightConfig } from '../../../../src/integrations/nuxt/index.ts'
import { defineMetricAdapter } from '../../../../src/metrics/index.ts'

export default defineNuxtInsightConfig({
    providers: [
        defineProvider({
            id: 'app',
            adapters: {
                usage: defineMetricAdapter({
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
