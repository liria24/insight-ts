import { createSeriesModel } from 'insight-ts/ui-core'

Object.assign(globalThis, {
    __insightBundleFixture: createSeriesModel(
        {
            data: {
                points: [{ time: '2026-08-31T00:00:00.000Z', values: { views: 1 } }],
                values: { views: 1 },
            },
            meta: { contributions: [], queriedAt: '2026-08-31T00:00:00.000Z' },
        },
        { colors: ['black'] },
    ),
})
