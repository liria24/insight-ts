import { describe, expect, expectTypeOf, it, vi } from 'vitest'
import { createSSRApp, defineComponent, h } from 'vue'
import { renderToString } from 'vue/server-renderer'

import { createBrowserInsight, type BrowserInsight } from '../src/integrations/browser/index.ts'
import { provideBrowserInsight, useBrowserInsight } from '../src/integrations/vue/index.ts'
import * as ui from '../src/integrations/vue/ui/index.ts'
import {
    InsightBarList,
    InsightBreakdownTable,
    InsightChart,
    InsightSparkline,
    InsightStat,
    type InsightBarListProps,
    type InsightBarListUI,
    type InsightBreakdownTableProps,
    type InsightChartProps,
    type InsightSparklineProps,
    type InsightSparklineUI,
    type InsightStatProps,
    type InsightUIClass,
} from '../src/integrations/vue/ui/index.ts'
import {
    createChartTooltipModel,
    createSeriesModel,
    type MetricQueryResult,
} from '../src/ui-core/index.ts'

interface Events {
    signup: { plan: string }
}

const data: MetricQueryResult<'pageViews' | 'visits', 'country'> = {
    aggregate: { pageViews: 2_626, visits: 1_701 },
    meta: {
        quality: { approximate: true, sampled: true, sampleRate: 0.25 },
        queriedAt: '2026-08-29T00:00:00.000Z',
        temporal: { bucketTimezone: 'UTC', grain: 'day' },
    },
    rows: [
        {
            dimensions: { country: 'JP' },
            time: '2026-08-26T00:00:00.000Z',
            values: { pageViews: 1_240, visits: 800 },
        },
        {
            dimensions: { country: 'US' },
            time: '2026-08-27T00:00:00.000Z',
            values: { pageViews: 1_386, visits: 901 },
        },
    ],
}

describe('Vue integration', () => {
    it('provides the browser client to descendants', async () => {
        const insight = createBrowserInsight<Events>({ fetch: vi.fn<typeof fetch>() })
        let injected: BrowserInsight<Events> | undefined
        const Child = defineComponent(() => {
            injected = useBrowserInsight<Events>()
            return () => h('span')
        })
        const app = createSSRApp(
            defineComponent(() => {
                provideBrowserInsight(insight)
                return () => h(Child)
            }),
        )

        await renderToString(app)
        expect(injected).toBe(insight)
    })

    it('uses data-only Metric Source props with inferred fields', () => {
        expect(ui).not.toHaveProperty('InsightLineChart')
        expect(ui).not.toHaveProperty('InsightAreaChart')
        expect(ui).not.toHaveProperty('InsightBarChart')
        expect(ui).not.toHaveProperty('InsightQualityNotice')
        expectTypeOf<InsightStatProps>().not.toHaveProperty('metric')
        expectTypeOf<InsightSparklineProps>().not.toHaveProperty('metric')
        expectTypeOf<InsightBarListProps<typeof data>>().not.toHaveProperty('metric')
        expectTypeOf<InsightBarListProps<typeof data>['dimension']>().toEqualTypeOf<'country'>()
        expectTypeOf<InsightChartProps['data']>().toEqualTypeOf<MetricQueryResult>()
        expectTypeOf<InsightChartProps['type']>().toEqualTypeOf<
            'area' | 'bar' | 'line' | undefined
        >()
        expectTypeOf<InsightBreakdownTableProps['data']>().toEqualTypeOf<MetricQueryResult>()
        expectTypeOf<InsightUIClass>().toEqualTypeOf<string | readonly string[]>()
        expectTypeOf<InsightBarListProps['ui']>().toEqualTypeOf<InsightBarListUI | undefined>()
        expectTypeOf<InsightSparklineProps['ui']>().toEqualTypeOf<InsightSparklineUI | undefined>()
        expectTypeOf<InsightChartProps>().not.toHaveProperty('metrics')
        expectTypeOf<InsightBreakdownTableProps>().not.toHaveProperty('dimensions')
    })

    it('renders all Metric components and selected metrics in Source order', async () => {
        const html = await renderToString(
            createSSRApp(() =>
                h('main', [
                    h(InsightStat, { data }),
                    h(InsightSparkline, {
                        data,
                        ui: { path: 'custom-sparkline-path', root: 'custom-sparkline' },
                    }),
                    h(InsightChart, { data, title: 'Traffic line' }),
                    h(InsightChart, { data, title: 'Traffic area', type: 'area' }),
                    h(InsightChart, { data, title: 'Traffic bars', type: 'bar' }),
                    h(InsightBarList, {
                        data,
                        dimension: 'country',
                        ui: {
                            bar: 'custom-bar',
                            item: 'custom-bar-item',
                            label: 'custom-bar-label',
                            list: 'custom-bar-list',
                            root: 'custom-bar-root',
                            track: 'custom-bar-track',
                            value: 'custom-bar-value',
                        },
                    }),
                    h(InsightBreakdownTable, { data }),
                ]),
            ),
        )

        expect(html).toContain('2,626')
        expect(html).toContain('Traffic line')
        expect(html).toContain('Traffic area')
        expect(html).toContain('Traffic bars')
        expect(html).toContain('Page Views')
        expect(html).toContain('Visits')
        expect(html).toContain('JP')
        expect(html).toContain('Results use 25% sampling')
        expect(html.match(/<svg/g)).toHaveLength(4)
        expect(html).toContain('data-chart-type="bar"')
        expect(html).toContain('<rect')
        expect(html).toContain('insight-bar-list__bar')
        expect(html).toContain('custom-bar-value')
        expect(html).toContain('custom-sparkline-path')
        expect(html).toContain('data-slot="table"')
    })

    it('builds renderer-independent series and tooltip models', () => {
        const model = createSeriesModel(data, {
            colors: ['#123456', '#654321'],
            yAxis: { domain: { max: 2_000, min: 0 } },
        })
        const bars = createSeriesModel(data, {
            colors: ['#123456', '#654321'],
            includeZero: true,
        })
        const tooltip = createChartTooltipModel(model, 1, 'en-US', 'UTC')

        expect(model.series.map(({ metric }) => metric)).toEqual(['pageViews', 'visits'])
        expect(model.yDomain).toEqual({ min: 0, max: 2_000 })
        expect(bars.yDomain.min).toBe(0)
        expect(tooltip?.values.map(({ value }) => value)).toEqual([1_386, 901])
    })

    it('bounds large chart and sparkline markup while keeping exact data available', async () => {
        const large: MetricQueryResult<'errors' | 'requests'> = {
            aggregate: { errors: 49_995_000, requests: 99_990_000 },
            meta: { queriedAt: '2026-01-08T00:00:00.000Z' },
            rows: Array.from({ length: 10_000 }, (_, index) => ({
                time: new Date(Date.UTC(2026, 0, 1) + index * 60_000).toISOString(),
                values: { errors: index, requests: index * 2 },
            })),
        }
        const html = await renderToString(
            createSSRApp(() =>
                h('main', [h(InsightChart, { data: large }), h(InsightSparkline, { data: large })]),
            ),
        )
        const sparklinePath = /data-slot="path" d="([^"]+)"/.exec(html)?.[1] ?? ''

        expect(html).toContain('Show exact data (10000 rows)')
        expect(html).not.toContain('<table')
        expect(sparklinePath.match(/L /g)).toHaveLength(199)
    })
})
