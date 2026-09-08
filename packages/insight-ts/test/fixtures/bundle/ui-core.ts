import { createSeriesModel } from 'insight-ts/ui-core'

Object.assign(globalThis, {
    __insightBundleFixture: createSeriesModel(
        {
            aggregate: { views: 1 },
            meta: { queriedAt: '2026-08-31T00:00:00.000Z' },
            rows: [{ time: '2026-08-31T00:00:00.000Z', values: { views: 1 } }],
        },
        { colors: ['black'] },
    ),
})
