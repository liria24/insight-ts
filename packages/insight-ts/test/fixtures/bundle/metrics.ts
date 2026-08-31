import { defineMetricSource } from 'insight-ts/metrics'

Object.assign(globalThis, {
    __insightBundleFixture: defineMetricSource({
        execute: () => ({ values: { views: 1 } }),
        metrics: { views: { aggregation: { kind: 'sum' }, rollup: 'additive' } },
    }),
})
