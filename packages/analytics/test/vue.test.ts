import { describe, expect, it, vi } from 'vitest'
import { createSSRApp, defineComponent, h } from 'vue'
import { renderToString } from 'vue/server-renderer'

import { createBrowserAnalytics, type BrowserAnalytics } from '../src/browser'
import type { AnalyticsSeriesReport, AnalyticsTableReport } from '../src/index'
import {
    AnalyticsBreakdownTable,
    AnalyticsLineChart,
    AnalyticsStat,
    createAnalyticsTimeFormatContext,
    formatAnalyticsTime,
    provideAnalytics,
    resolveAnalyticsTimezone,
    type AnalyticsChartSeries,
    type AnalyticsStatUI,
    type AnalyticsTimezone,
    type AnalyticsYAxisDomain,
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

    it('applies root class, ui classes, data slots, attrs, and passes resolved ui to slots', async () => {
        const app = createSSRApp(() =>
            h(
                AnalyticsStat,
                {
                    class: 'consumer-root',
                    'data-example': 'forwarded',
                    'data-slot': 'consumer-root-slot',
                    metric: 'pageViews',
                    report: createReport(),
                    ui: {
                        label: 'consumer-label',
                        value: 'consumer-value',
                    },
                },
                {
                    value: ({ formatted, ui }: { formatted: string; ui: AnalyticsStatUI }) =>
                        h('strong', { class: ui.value, 'data-slot': 'custom-value' }, formatted),
                },
            ),
        )

        const html = await renderToString(app)

        expect(html).toContain('analytics-stat consumer-root')
        expect(html).toContain('data-example="forwarded"')
        expect(html).toContain('data-slot="consumer-root-slot"')
        expect(html).toContain('analytics-stat__label consumer-label')
        expect(html).toContain('analytics-stat__value consumer-value')
        expect(html).toContain('data-slot="custom-value"')
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
        expect(html).toContain('data-slot="base"')
        expect(html).toContain('data-slot="thead"')
        expect(html).toContain('data-slot="tbody"')
        expect(html).toContain('data-slot="th"')
        expect(html).toContain('data-slot="td"')
    })

    it('keeps a fixed chart height and never renders raw ISO labels by default', async () => {
        const html = await renderToString(
            createSSRApp(() => h(AnalyticsLineChart, { report: createReport(), title: 'Traffic' })),
        )

        expect(html).toContain('height:360px')
        expect(html).toContain('min-height:360px')
        expect(html).toContain('width:100%')
        expect(html).toContain('Aug 19')
        expect(html).not.toContain('2026-08-19T00:00:00.000Z')
        expect(html).toContain('data-slot="legend"')
    })

    it('pads constant Y series and exposes renderer-independent axis output to the chart slot', async () => {
        const report = createReport().points.map((point) => ({
            ...point,
            values: { pageViews: 100 },
        }))
        let captured:
            | {
                  labels: readonly string[]
                  series: readonly AnalyticsChartSeries[]
                  timezone: AnalyticsTimezone
                  yDomain: AnalyticsYAxisDomain
              }
            | undefined
        const app = createSSRApp(() =>
            h(
                AnalyticsLineChart,
                {
                    report: { ...createReport(), points: report },
                    xAxis: { formatter: (_, context) => `tick-${context.index}`, maxTicks: 1 },
                    yAxis: { includeZero: false },
                },
                {
                    chart: (properties: NonNullable<typeof captured>) => {
                        captured = properties
                        return h('span', 'custom chart')
                    },
                },
            ),
        )

        await renderToString(app)

        expect(captured?.labels).toEqual(['', 'tick-1'])
        expect(captured?.timezone).toBe('UTC')
        expect(captured?.yDomain).toEqual({ min: 95, max: 105 })
        expect(captured?.series[0]?.metric).toBe('pageViews')
    })

    it('honors maxTicks and x/y axis overrides', async () => {
        const base = createReport()
        const points = Array.from({ length: 10 }, (_, index) => ({
            time: `2026-08-${String(index + 1).padStart(2, '0')}T00:00:00.000Z`,
            values: { pageViews: index + 1 },
        }))
        let labels: readonly string[] = []
        let domain: AnalyticsYAxisDomain | undefined
        const app = createSSRApp(() =>
            h(
                AnalyticsLineChart,
                {
                    report: { ...base, points },
                    xAxis: { formatter: (_, context) => `day-${context.index}`, maxTicks: 3 },
                    yAxis: { max: 20, min: 0, padding: 0 },
                },
                {
                    chart: (properties: {
                        labels: readonly string[]
                        yDomain: AnalyticsYAxisDomain
                    }) => {
                        labels = properties.labels
                        domain = properties.yDomain
                        return h('span', 'custom chart')
                    },
                },
            ),
        )

        await renderToString(app)

        expect(labels.filter(Boolean)).toEqual(['day-0', 'day-5', 'day-9'])
        expect(domain).toEqual({ min: 0, max: 20 })
    })

    it('resolves timezone deterministically and formats with the requested locale', () => {
        const report = createReport()
        const sourceTimezoneReport: AnalyticsSeriesReport = {
            ...report,
            meta: {
                ...report.meta,
                temporal: { grain: 'day', sourceTimezone: 'Asia/Tokyo' },
            },
        }
        const utcContext = createAnalyticsTimeFormatContext(report, 0, 'en-US')
        const japaneseContext = createAnalyticsTimeFormatContext(report, 0, 'ja-JP', 'Asia/Tokyo')

        expect(resolveAnalyticsTimezone(report)).toBe('UTC')
        expect(resolveAnalyticsTimezone(sourceTimezoneReport)).toBe('Asia/Tokyo')
        expect(resolveAnalyticsTimezone(report, 'local')).toBe('local')
        expect(formatAnalyticsTime(new Date('2026-08-23T00:00:00.000Z'), utcContext)).toBe('Aug 23')
        expect(formatAnalyticsTime(new Date('2026-08-23T00:00:00.000Z'), japaneseContext)).toBe(
            '8月23日',
        )
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
