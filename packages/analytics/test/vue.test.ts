import { describe, expect, expectTypeOf, it, vi } from 'vitest'
import { createSSRApp, defineComponent, h } from 'vue'
import { renderToString } from 'vue/server-renderer'

import { createBrowserAnalytics, type BrowserAnalytics } from '../src/browser'
import type {
    AnalyticsScalarReport,
    AnalyticsSeriesReport,
    AnalyticsTableReport,
} from '../src/index'
import {
    createAnalyticsChartTooltip,
    createAnalyticsSeriesPresentation,
    createAnalyticsTimeFormatContext,
    formatAnalyticsTime,
    resolveAnalyticsTimezone,
} from '../src/presentation'
import { provideAnalytics, useAnalytics } from '../src/vue'
import {
    AnalyticsAreaChart,
    AnalyticsBreakdownTable,
    AnalyticsLineChart,
    AnalyticsStat,
    type AnalyticsAreaChartProps,
    type AnalyticsBreakdownTableProps,
    type AnalyticsLineChartProps,
    type AnalyticsStatProps,
    type AnalyticsUIClass,
} from '../src/vue-ui-entry'

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

    it('keeps report kinds strict and UI classes framework-neutral', () => {
        expectTypeOf<AnalyticsStatProps['report']>().toEqualTypeOf<AnalyticsScalarReport>()
        expectTypeOf<AnalyticsLineChartProps['report']>().toEqualTypeOf<AnalyticsSeriesReport>()
        expectTypeOf<AnalyticsAreaChartProps['report']>().toEqualTypeOf<AnalyticsSeriesReport>()
        expectTypeOf<AnalyticsBreakdownTableProps['report']>().toEqualTypeOf<AnalyticsTableReport>()
        expectTypeOf<AnalyticsUIClass>().toEqualTypeOf<string | readonly string[]>()
    })

    it('renders scalar and table reports with semantic UI slots', async () => {
        const html = await renderToString(
            createSSRApp(() =>
                h('main', [
                    h(AnalyticsStat, {
                        class: 'consumer-root',
                        metric: 'pageViews',
                        report: createScalarReport(),
                        ui: { label: ['muted', 'compact'], value: 'strong' },
                    }),
                    h(AnalyticsBreakdownTable, {
                        dimensions: ['country'],
                        metrics: ['pageViews'],
                        report: createTableReport(),
                    }),
                ]),
            ),
        )

        expect(html).toContain('analytics-stat consumer-root')
        expect(html).toContain('muted compact')
        expect(html).toContain('1,386')
        expect(html).toContain('data-slot="table"')
        expect(html).toContain('data-slot="header-cell"')
        expect(html).toContain('data-slot="cell"')
        expect(html).toContain('JP')
    })

    it('server-renders line and area SVGs, multiple metrics, and exact-value data', async () => {
        const report = createSeriesReport()
        const html = await renderToString(
            createSSRApp(() =>
                h('main', [
                    h(AnalyticsLineChart, {
                        metrics: ['pageViews', 'visits'],
                        report,
                        title: 'Traffic line',
                    }),
                    h(AnalyticsAreaChart, {
                        metrics: ['pageViews', 'visits'],
                        report,
                        title: 'Traffic area',
                    }),
                ]),
            ),
        )

        expect(html.match(/<svg/g)).toHaveLength(2)
        expect(html.match(/ts-chart-surface/g)).toHaveLength(2)
        expect(html).toContain('Traffic line')
        expect(html).toContain('Traffic area')
        expect(html).toContain('Page Views')
        expect(html).toContain('Visits')
        expect(html).toContain('901')
        expect(html).toContain('analytics-chart__data analytics-sr-only')
        expect(html).toContain('height:360px')
        expect(html).toContain('min-height:360px')
        expect(html).toContain('viewBox="0 0 640 360"')
    })

    it('uses line marks and overlays area plus line marks without stacking', async () => {
        const report = createSeriesReport()
        const [line, area] = await Promise.all([
            renderToString(createSSRApp(() => h(AnalyticsLineChart, { report, smooth: true }))),
            renderToString(
                createSSRApp(() =>
                    h(AnalyticsAreaChart, {
                        metrics: ['pageViews', 'visits'],
                        report,
                        smooth: false,
                    }),
                ),
            ),
        ])

        expect(line).toContain('data-ts-key="line-pageViews:')
        expect(line).toMatch(/<path[^>]+d="[^"]*C[^"]*"/)
        expect(area).toContain('data-ts-key="area-pageViews:')
        expect(area).toContain('data-ts-key="area-visits:')
        expect(area).toContain('data-ts-key="line-pageViews:')
        expect(area).toContain('data-ts-key="line-visits:')
        expect(area).toMatch(/<path[^>]+d="[^"]*L[^"]*"/)
    })

    it('preserves real time gaps and resolves locale, timezone, formatters, and domain', () => {
        const report = createSeriesReport()
        const model = createAnalyticsSeriesPresentation(report, {
            locale: 'ja-JP',
            metrics: ['visits'],
            timezone: 'Asia/Tokyo',
            xAxis: { formatter: (date, context) => `${context.timezone}:${date.getUTCDate()}` },
            yAxis: { max: 2_000, min: 0 },
        })
        const times = model.series[0]!.values.map(({ time }) => time)

        expect(model.metrics).toEqual(['visits'])
        expect(model.timezone).toBe('Asia/Tokyo')
        expect(model.labels).toEqual(['Asia/Tokyo:26', 'Asia/Tokyo:27', 'Asia/Tokyo:31'])
        expect(model.yDomain).toEqual({ min: 0, max: 2_000 })
        expect(model.timeDomain).toEqual([times[0], times[2]])
        expect(times[1]! - times[0]!).toBe(86_400_000)
        expect(times[2]! - times[1]!).toBe(4 * 86_400_000)

        const sourceTimezoneReport: AnalyticsSeriesReport = {
            ...report,
            meta: { ...report.meta, temporal: { grain: 'day', sourceTimezone: 'Asia/Tokyo' } },
        }
        expect(resolveAnalyticsTimezone(report)).toBe('UTC')
        expect(resolveAnalyticsTimezone(sourceTimezoneReport)).toBe('Asia/Tokyo')
        expect(
            formatAnalyticsTime(
                new Date('2026-08-27T00:00:00.000Z'),
                createAnalyticsTimeFormatContext(report, 1, 'ja-JP', 'Asia/Tokyo'),
            ),
        ).toBe('8月27日')
    })

    it('creates renderer-independent tooltip values with axis formatting', () => {
        const report = createSeriesReport()
        const model = createAnalyticsSeriesPresentation(report, {
            colors: ['#123456', '#654321'],
        })
        const tooltip = createAnalyticsChartTooltip(
            report,
            model.series,
            1,
            'en-US',
            'UTC',
            { formatter: (_date, context) => `point-${context.index}` },
            { formatter: (value) => `${value} views` },
        )

        expect(tooltip).toEqual({
            label: 'point-1',
            point: report.points[1],
            values: [
                {
                    color: '#123456',
                    formatted: '1300 views',
                    metric: 'pageViews',
                    name: 'Page Views',
                    value: 1300,
                },
                {
                    color: '#654321',
                    formatted: '901 views',
                    metric: 'visits',
                    name: 'Visits',
                    value: 901,
                },
            ],
        })
    })

    it('renders quality, empty, and semantic replacement slots without exposing ui', async () => {
        const report = createSeriesReport()
        const quality = await renderToString(
            createSSRApp(() =>
                h(
                    AnalyticsAreaChart,
                    {
                        report: {
                            ...report,
                            meta: {
                                ...report.meta,
                                quality: { approximate: true, partial: true },
                            },
                        },
                        title: 'Quality traffic',
                    },
                    {
                        title: ({ title }: { title: string }) => h('h2', title),
                    },
                ),
            ),
        )
        const empty = await renderToString(
            createSSRApp(() => h(AnalyticsLineChart, { report: { ...report, points: [] } })),
        )

        expect(quality).toContain('<h2>Quality traffic</h2>')
        expect(quality).toContain('Partial data · Approximate data')
        expect(quality).toContain('data-slot="quality"')
        expect(empty).toContain('No data')
        expect(empty).toContain('role="status"')
        expect(empty).not.toContain('<svg')
    })
})

function reportMeta() {
    return {
        quality: {},
        queriedAt: '2026-08-31T00:00:00.000Z',
        source: 'vue-test',
        temporal: { bucketTimezone: 'UTC', grain: 'day' as const },
    }
}

function createScalarReport(): AnalyticsScalarReport {
    return { kind: 'scalar', meta: reportMeta(), values: { pageViews: 1386 } }
}

function createSeriesReport(): AnalyticsSeriesReport {
    return {
        kind: 'series',
        meta: reportMeta(),
        points: [
            {
                time: '2026-08-26T00:00:00.000Z',
                values: { pageViews: 1240, visits: 800 },
            },
            {
                time: '2026-08-27T00:00:00.000Z',
                values: { pageViews: 1300, visits: 901 },
            },
            {
                time: '2026-08-31T00:00:00.000Z',
                values: { pageViews: 1386, visits: 950 },
            },
        ],
    }
}

function createTableReport(): AnalyticsTableReport {
    return {
        kind: 'table',
        meta: reportMeta(),
        rows: [
            { dimensions: { country: 'JP' }, metrics: { pageViews: 12 } },
            { dimensions: { country: 'US' }, metrics: { pageViews: 8 } },
        ],
    }
}
