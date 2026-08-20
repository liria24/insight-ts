import { describe, expect, it, vi } from 'vitest'
import { createSSRApp, defineComponent, h } from 'vue'
import { renderToString } from 'vue/server-renderer'

import { createBrowserAnalytics, type BrowserAnalytics } from '../src/browser'
import type { AnalyticsSeriesReport } from '../src/index'
import {
    AnalyticsDashboard,
    AnalyticsKpiCard,
    AnalyticsSeriesChart,
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

    it('renders KPI and series dashboard components from a core report', async () => {
        const report = createReport()
        const app = createSSRApp(() => h(AnalyticsDashboard, { report, title: 'Traffic' }))

        const html = await renderToString(app)

        expect(html).toContain('Traffic')
        expect(html).toContain('Page Views')
        expect(html).toContain('1,386')
        expect(html).toContain('Trend')
    })

    it('renders an accessible empty state for null KPI values', async () => {
        const app = createSSRApp(() => h(AnalyticsKpiCard, { label: 'Visits', value: null }))

        const html = await renderToString(app)

        expect(html).toContain('Visits')
        expect(html).toContain('No data')
        expect(html).toContain('role="status"')
    })

    it('renders an accessible empty state for a non-series report', async () => {
        const report = Object.assign(createReport(), { kind: 'scalar' as const })
        const app = createSSRApp(() => h(AnalyticsSeriesChart, { report }))

        const html = await renderToString(app)

        expect(html).toContain('No time series data')
        expect(html).toContain('role="status"')
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
