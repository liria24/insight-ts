import { createInsight, defineProvider } from 'insight-ts'
import { defineMetricAdapter } from 'insight-ts/metrics'

const adapter = defineMetricAdapter({
    execute: () => ({ values: { value: 1 } }),
    metrics: { value: {} },
})

Object.assign(globalThis, {
    __insightBundleFixture: createInsight({
        providers: [defineProvider({ adapters: { value: adapter }, id: 'fixture' })],
    }),
})
