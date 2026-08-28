import type { AnalyticsSeriesReport } from '@liria24/analytics'

import type { DemoReportQuery, DemoReportResponse } from '../../shared/demo-range'

const fixtureValues = [
    { pageViews: 1058, visits: 692 },
    { pageViews: 1136, visits: 744 },
    { pageViews: 1198, visits: 781 },
    { pageViews: 1164, visits: 762 },
    { pageViews: 1240, visits: 812 },
    { pageViews: 1386, visits: 901 },
    { pageViews: 1421, visits: 936 },
]

export function createDemoFixture(query: DemoReportQuery, now = new Date()): DemoReportResponse {
    const from = new Date(query.range.from)
    const to = new Date(query.range.to)
    const points = []
    for (
        let time = from, index = 0;
        time < to && index < 400;
        time = next(time, query.grain), index++
    ) {
        const base = fixtureValues[index % fixtureValues.length] ?? fixtureValues[0]
        if (base) points.push({ time: time.toISOString(), values: base })
    }
    const series: AnalyticsSeriesReport = {
        kind: 'series',
        meta: {
            quality: {},
            queriedAt: now.toISOString(),
            source: 'demo-fixture',
            temporal: { bucketTimezone: 'UTC', grain: query.grain },
        },
        points,
    }
    return {
        online: 0,
        series,
        summary: {
            kind: 'scalar',
            meta: series.meta,
            values: {
                pageViews: points.reduce((sum, point) => sum + (point.values.pageViews ?? 0), 0),
                visits: points.reduce((sum, point) => sum + (point.values.visits ?? 0), 0),
            },
        },
    }
}

function next(value: Date, grain: DemoReportQuery['grain']): Date {
    const date = new Date(value)
    if (grain === 'hour') date.setUTCHours(date.getUTCHours() + 1)
    else if (grain === 'day') date.setUTCDate(date.getUTCDate() + 1)
    else if (grain === 'week') date.setUTCDate(date.getUTCDate() + 7)
    else if (grain === 'month') date.setUTCMonth(date.getUTCMonth() + 1)
    else date.setUTCFullYear(date.getUTCFullYear() + 1)
    return date
}

if ((import.meta as { main?: boolean }).main) {
    const report = createDemoFixture({
        grain: 'day',
        range: {
            from: '2026-08-14T00:00:00.000Z',
            to: '2026-08-21T00:00:00.000Z',
        },
    })
    if (
        report.series.points.length !== 7 ||
        report.series.points.at(-1)?.time !== '2026-08-20T00:00:00.000Z'
    ) {
        throw new Error('Demo fixture must follow the requested range')
    }
}
