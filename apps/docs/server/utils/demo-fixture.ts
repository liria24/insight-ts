import type { AnalyticsSeriesReport } from '@liria24/analytics'

const fixtureValues = [
    { pageViews: 1058, visits: 692 },
    { pageViews: 1136, visits: 744 },
    { pageViews: 1198, visits: 781 },
    { pageViews: 1164, visits: 762 },
    { pageViews: 1240, visits: 812 },
    { pageViews: 1386, visits: 901 },
    { pageViews: 1421, visits: 936 },
]

export function createDemoFixture(now = new Date()): AnalyticsSeriesReport {
    const today = new Date(now)
    today.setUTCHours(0, 0, 0, 0)

    return {
        kind: 'series',
        meta: {
            quality: {},
            queriedAt: now.toISOString(),
            source: 'demo-fixture',
            temporal: { bucketTimezone: 'UTC', grain: 'day' },
        },
        points: fixtureValues.map((values, index) => {
            const time = new Date(today)
            time.setUTCDate(today.getUTCDate() - fixtureValues.length + index + 1)
            return { time: time.toISOString(), values }
        }),
    }
}

if ((import.meta as { main?: boolean }).main) {
    const report = createDemoFixture(new Date('2026-08-20T15:30:00.000Z'))
    if (
        report.points.length !== 7 ||
        report.points[0]?.time !== '2026-08-14T00:00:00.000Z' ||
        report.points.at(-1)?.time !== '2026-08-20T00:00:00.000Z'
    ) {
        throw new Error('Demo fixture must cover today and the previous six UTC days')
    }
}
