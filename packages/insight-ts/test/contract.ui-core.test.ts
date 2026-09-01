import { describe, expect, it } from 'vitest'

import {
    createBreakdownModel,
    createChartTooltipModel,
    createDataNotices,
    createSeriesModel,
    createStatModel,
    type MetricQueryResult,
} from '../src/ui-core/index.ts'

const data: MetricQueryResult<'pageViews' | 'visits', 'country'> = {
    data: {
        points: [
            {
                dimensions: { country: 'US' },
                time: '2026-08-02T00:00:00.000Z',
                values: { pageViews: 13, visits: 9 },
            },
            {
                dimensions: { country: 'JP' },
                time: '2026-08-01T00:00:00.000Z',
                values: { pageViews: 12, visits: 8 },
            },
        ],
        values: { pageViews: 25, visits: 17 },
    },
    meta: {
        contributions: [],
        fidelity: [
            {
                preservation: 'reduced',
                range: {
                    from: '2026-08-01T00:00:00.000Z',
                    to: '2026-08-02T00:00:00.000Z',
                },
                transformations: [{ kind: 'sample', rate: 0.5 }],
            },
        ],
        quality: { partial: true, sampled: true, sampleRate: 0.5 },
        queriedAt: '2026-08-03T00:00:00.000Z',
    },
}

describe('UI Core contract', () => {
    it('builds renderer-independent models while preserving Metric order and Fidelity', () => {
        const series = createSeriesModel(data, {
            colors: ['red', 'blue'],
            yAxis: { domain: { min: 0 } },
        })
        const breakdown = createBreakdownModel(data)
        const tooltip = createChartTooltipModel(data, series.series, 0, 'en-US', 'UTC')

        expect(createStatModel(data)).toEqual({ metric: 'pageViews', value: 25 })
        expect(series.series.map(({ metric }) => metric)).toEqual(['pageViews', 'visits'])
        expect(series.points.map(({ dimensions }) => dimensions?.country)).toEqual(['JP', 'US'])
        expect(series.fidelityBands[0]).toMatchObject({
            from: Date.parse('2026-08-01T00:00:00.000Z'),
            preservation: 'reduced',
        })
        expect(breakdown).toMatchObject({
            dimensions: ['country'],
            metrics: ['pageViews', 'visits'],
        })
        expect(tooltip?.values.map(({ value }) => value)).toEqual([12, 8])
        expect(createDataNotices(data.meta.quality).map(({ code }) => code)).toEqual([
            'partial',
            'sampled',
        ])
    })
})
