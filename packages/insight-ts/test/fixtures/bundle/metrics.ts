import { defineMetricAdapter } from 'insight-ts/metrics'

Object.assign(globalThis, {
    __insightBundleFixture: defineMetricAdapter({
        execute: () => ({ values: { views: 1 } }),
        metrics: { views: { aggregation: { kind: 'sum' }, rollup: 'additive' } },
    }),
})
