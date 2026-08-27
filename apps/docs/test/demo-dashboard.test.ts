import { describe, expect, it } from 'bun:test'

import type { AnalyticsSeriesReport } from '@liria24/analytics'
import { createAnalyticsTimeFormatContext, formatAnalyticsTime } from '@liria24/analytics/vue'

import { formatDemoReportTime, selectDemoReportRange } from '../app/utils/demo-report'

const report: AnalyticsSeriesReport = {
    kind: 'series',
    meta: {
        quality: {},
        queriedAt: '2026-08-27T00:00:00.000Z',
        source: 'demo-test',
        temporal: { bucketTimezone: 'UTC', grain: 'day' },
    },
    points: Array.from({ length: 7 }, (_, index) => ({
        time: `2026-08-${String(index + 20).padStart(2, '0')}T00:00:00.000Z`,
        values: { visits: index + 1 },
    })),
}

describe('DemoDashboard range', () => {
    it('uses the two slider indexes to create the report shown by the chart', () => {
        expect(selectDemoReportRange(report, [0, 6]).points).toHaveLength(7)
        expect(selectDemoReportRange(report, [2, 4]).points.map(({ time }) => time)).toEqual([
            '2026-08-22T00:00:00.000Z',
            '2026-08-23T00:00:00.000Z',
            '2026-08-24T00:00:00.000Z',
        ])
    })

    it('uses the Analytics Vue formatter for slider date labels', () => {
        expect(formatDemoReportTime(report, 3, 'en-US')).toBe(
            formatAnalyticsTime(
                new Date(report.points[3]?.time ?? ''),
                createAnalyticsTimeFormatContext(report, 3, 'en-US'),
            ),
        )
    })
})
