import { describe, expect, it } from 'bun:test'

import { createDemoFixture } from '../server/utils/demo-fixture'
import { resolveDemoReportQuery } from '../shared/demo-range'

const now = new Date('2026-08-21T12:00:00.000Z')

describe('Demo analytics range', () => {
    it('embeds live UI examples with reproduction code on every UI page', async () => {
        const pages = {
            '1.styling.md': 'styling',
            '2.stat.md': 'stat',
            '3.line-chart.md': 'line',
            '4.area-chart.md': 'area',
            '5.breakdown-table.md': 'breakdown',
        } as const
        await Promise.all(
            Object.entries(pages).map(async ([file, kind]) => {
                const content = await Bun.file(
                    new URL(`../content/5.ui/${file}`, import.meta.url),
                ).text()
                expect(content).toContain(`analytics-ui-docs-example{kind="${kind}"}`)
            }),
        )
        const example = await Bun.file(
            new URL('../app/components/AnalyticsUiDocsExample.vue', import.meta.url),
        ).text()
        expect(example).toContain('Live example')
        expect(example).toContain('Reproduction code')
    })

    it('renders the main report through the SSR area chart path', async () => {
        const source = await Bun.file(new URL('../app/pages/demo.vue', import.meta.url)).text()

        expect(source).toContain('AnalyticsAreaChart')
        expect(source).toContain("from '@liria24/analytics/vue/ui'")
        expect(source).toContain('await useFetch<DemoReportResponse>')
        expect(source).not.toContain('AnalyticsLineChart')
        expect(source).not.toContain('useLazyFetch')
        expect(source).not.toContain('server: false')
    })

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
        expect(report.online).toBe(0)
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
