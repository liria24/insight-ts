import { describe, expect, it, vi } from 'vitest'
import { createSSRApp, defineComponent, h } from 'vue'
import { renderToString } from 'vue/server-renderer'

import { createBrowserAnalytics, type BrowserAnalytics } from '../src/browser'
import type { AnalyticsSeriesReport, AnalyticsTableReport } from '../src/index'
import {
    AnalyticsBreakdownTable,
    AnalyticsLineChart,
    AnalyticsStat,
    provideAnalytics,
    useAnalytics,
} from '../src/vue'

interface Events {
    signup: { plan: string }
}

describe('Vue integration', () => {
    it('provides the browser client to descendants', async () => {
        const analytics = createBrowserAnalytics<Events>({ fetch: vi.fn<typeof fetch>() })
        let injected: BrowserAnalytics<Events> | undefined
        const Child = defineComponent(() => {
            injected = useAnalytics<Events>()
            return () => h('span')
        })
        const app = createSSRApp(
            defineComponent(() => {
                provideAnalytics(analytics)
                return () => h(Child)
            }),
        )

        await renderToString(app)

        expect(injected).toBe(analytics)
    })

    it('renders report-only stat and line chart primitives', async () => {
        const report = createReport()
        const app = createSSRApp(() =>
            h('main', [
                h(AnalyticsStat, { metric: 'pageViews', report }),
                h(AnalyticsLineChart, {
                    colors: ['#123456'],
                    metrics: ['pageViews', 'visits'],
                    report,
                    smooth: true,
                    title: 'Traffic',
                }),
            ]),
        )

        const html = await renderToString(app)

        expect(html).toContain('Page Views')
        expect(html).toContain('1,386')
        expect(html).toContain('Traffic')
        expect(html).toContain('Visits: 901')
    })

    it('allows the stat value slot to replace default formatting', async () => {
        const app = createSSRApp(() =>
            h(
                AnalyticsStat,
                { metric: 'pageViews', report: createReport() },
                {
                    value: ({ value }: { value: number }) =>
                        h('strong', { class: 'custom-value' }, `${value} views`),
                },
            ),
        )

        const html = await renderToString(app)

        expect(html).toContain('custom-value')
        expect(html).toContain('1386 views')
    })

    it('renders an accessible empty state for unavailable metrics and report kinds', async () => {
        const report = createReport()
        const app = createSSRApp(() =>
            h('main', [
                h(AnalyticsStat, { metric: 'missing', report }),
                h(AnalyticsLineChart, {
                    report: {
                        kind: 'scalar',
                        meta: report.meta,
                        values: { pageViews: 1 },
                    },
                }),
            ]),
        )

        const html = await renderToString(app)

        expect(html).toContain('No data')
        expect(html).toContain('No time series data')
        expect(html).toContain('role="status"')
    })

    it('renders table reports without aggregating breakdown rows', async () => {
        const report: AnalyticsTableReport = {
            kind: 'table',
            meta: createReport().meta,
            rows: [
                { dimensions: { country: 'JP' }, metrics: { pageViews: 12 } },
                { dimensions: { country: 'US' }, metrics: { pageViews: 8 } },
            ],
        }
        const app = createSSRApp(() =>
            h(AnalyticsBreakdownTable, {
                dimensions: ['country'],
                metrics: ['pageViews'],
                report,
            }),
        )

        const html = await renderToString(app)

        expect(html).toContain('Country')
        expect(html).toContain('Page Views')
        expect(html).toContain('JP')
        expect(html).toContain('12')
    })
})

function createReport(): AnalyticsSeriesReport {
    return {
        kind: 'series',
        meta: {
            quality: {},
            queriedAt: '2026-08-20T00:00:00.000Z',
            source: 'vue-test',
            temporal: { bucketTimezone: 'UTC', grain: 'day' },
        },
        points: [
            {
                time: '2026-08-19T00:00:00.000Z',
                values: { pageViews: 1240, visits: null },
            },
            {
                time: '2026-08-20T00:00:00.000Z',
                values: { pageViews: 1386, visits: 901 },
            },
        ],
    }
}
