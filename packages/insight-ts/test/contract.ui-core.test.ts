import { describe, expect, it, vi } from 'vitest'

import {
    createBreakdownModel,
    createChartTooltipModel,
    createDataNotices,
    createSeriesModel,
    createStatModel,
    formatAxisTime,
    formatNumber,
    type MetricQueryResult,
} from '../src/ui-core/index.ts'

const data: MetricQueryResult<'pageViews' | 'visits', 'country'> = {
    aggregate: { pageViews: 25, visits: 17 },
    meta: {
        quality: { partial: true, sampled: true, sampleRate: 0.5 },
        queriedAt: '2026-08-03T00:00:00.000Z',
    },
    rows: [
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
}

describe('UI Core contract', () => {
    it('builds renderer-independent models while preserving Metric order', () => {
        const series = createSeriesModel(data, {
            colors: ['red', 'blue'],
            yAxis: { domain: { min: 0 } },
        })
        const breakdown = createBreakdownModel(data)
        const tooltip = createChartTooltipModel(series, 0, 'en-US', 'UTC')

        expect(createStatModel(data)).toEqual({ metric: 'pageViews', value: 25 })
        expect(series.series.map(({ metric }) => metric)).toEqual(['pageViews', 'visits'])
        expect(series.points.map(({ dimensions }) => dimensions?.country)).toEqual(['JP', 'US'])
        expect(breakdown).toMatchObject({
            dimensions: ['country'],
            metrics: ['pageViews', 'visits'],
        })
        expect(tooltip?.values.map(({ value }) => value)).toEqual([12, 8])
        expect(createDataNotices(data.meta.quality).map(({ code }) => code)).toEqual([
            'partial',
            'sampled',
        ])
        expect(series.points[0]).toMatchObject({
            key: expect.any(String),
            timestamp: Date.parse('2026-08-01T00:00:00.000Z'),
        })
        expect(breakdown.rows[0]?.metrics).toBe(data.rows?.[0]?.values)
    })

    it('retains exact large results while bounding chart geometry', () => {
        const rows = Array.from({ length: 10_000 }, (_, index) => ({
            time: new Date(Date.UTC(2026, 0, 1) + index * 60_000).toISOString(),
            values: { errors: index, requests: index * 2 },
        }))
        const result: MetricQueryResult<'errors' | 'requests'> = {
            aggregate: { errors: 49_995_000, requests: 99_990_000 },
            meta: { queriedAt: '2026-01-08T00:00:00.000Z' },
            rows,
        }
        const parse = vi.spyOn(Date, 'parse')

        const model = createSeriesModel(result, {
            colors: ['red', 'blue'],
            includeZero: true,
            maxPoints: 500,
        })

        expect(parse).toHaveBeenCalledTimes(rows.length)
        expect(model.points).toHaveLength(rows.length)
        expect(model.series.map(({ values }) => values.length)).toEqual([500, 500])
        expect(model.series[0]?.values.at(-1)?.index).toBe(rows.length - 1)
        expect(model.yDomain).toEqual({ min: 0, max: 19_998 })
        expect(
            createChartTooltipModel(model, rows.length - 1)?.values.map(({ value }) => value),
        ).toEqual([9_999, 19_998])
        expect(result.rows).toBe(rows)
    })

    it('reuses number and time formatters for the same configuration', () => {
        const numberFormat = vi.spyOn(Intl, 'NumberFormat')
        const dateTimeFormat = vi.spyOn(Intl, 'DateTimeFormat')

        formatNumber(1, 'en-GB', 7)
        formatNumber(2, 'en-GB', 7)
        formatAxisTime(0, 'en-GB', 'Asia/Tokyo')
        formatAxisTime(1, 'en-GB', 'Asia/Tokyo')

        expect(numberFormat).toHaveBeenCalledTimes(1)
        expect(dateTimeFormat).toHaveBeenCalledTimes(1)
        vi.restoreAllMocks()
    })
})
