import { describe, expect, it } from 'bun:test'

import { createDemoFixture } from '../server/utils/demo-fixture'
import { resolveDemoReportQuery } from '../shared/demo-range'

const now = new Date('2026-08-21T12:00:00.000Z')

describe('Demo analytics range', () => {
    it('resolves application presets to absolute ranges and sums the visible series', () => {
        const query = resolveDemoReportQuery({ range: '7d' }, now)
        const report = createDemoFixture(query, now)

        expect(query).toEqual({
            grain: 'day',
            range: {
                from: '2026-08-14T12:00:00.000Z',
                to: '2026-08-21T12:00:00.000Z',
            },
        })
        expect(report.series.points).toHaveLength(7)
        expect(report.summary.values.pageViews).toBe(
            report.series.points.reduce((sum, point) => sum + (point.values.pageViews ?? 0), 0),
        )
    })

    it('uses the selected calendar interval and rejects invalid ranges', () => {
        expect(
            resolveDemoReportQuery(
                { from: '2026-08-01T00:00:00.000Z', to: '2026-08-08T00:00:00.000Z' },
                now,
            ),
        ).toMatchObject({ grain: 'day' })
        expect(() =>
            resolveDemoReportQuery(
                { from: '2026-08-08T00:00:00.000Z', to: '2026-08-01T00:00:00.000Z' },
                now,
            ),
        ).toThrow()
    })
})
