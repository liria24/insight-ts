import { createSeriesModel } from 'insight-ts/ui-core'

Object.assign(globalThis, {
    __insightBundleFixture: createSeriesModel(
        {
            data: {
                views: {
                    points: [{ time: '2026-08-31T00:00:00.000Z', value: 1 }],
                    value: 1,
                },
            },
            meta: { queriedAt: '2026-08-31T00:00:00.000Z', source: 'fixture' },
        },
        { colors: ['black'] },
    ),
})
