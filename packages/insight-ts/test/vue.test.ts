import { describe, expect, expectTypeOf, it, vi } from 'vitest'
import { createSSRApp, defineComponent, h } from 'vue'
import { renderToString } from 'vue/server-renderer'

import { createBrowserInsight, type BrowserInsight } from '../src/integrations/browser/index.ts'
import { provideBrowserInsight, useBrowserInsight } from '../src/integrations/vue/index.ts'
import {
    InsightAreaChart,
    InsightBarChart,
    InsightBreakdownTable,
    InsightLineChart,
    InsightQualityNotice,
    InsightSparkline,
    InsightStat,
    type InsightAreaChartProps,
    type InsightBarChartProps,
    type InsightBarChartUI,
    type InsightBreakdownTableProps,
    type InsightLineChartProps,
    type InsightQualityNoticeProps,
    type InsightQualityNoticeUI,
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
    data: {
        pageViews: {
            points: [
                { dimensions: { country: 'JP' }, time: '2026-08-26T00:00:00.000Z', value: 1_240 },
                { dimensions: { country: 'US' }, time: '2026-08-27T00:00:00.000Z', value: 1_386 },
            ],
            value: 2_626,
        },
        visits: {
            points: [
                { dimensions: { country: 'JP' }, time: '2026-08-26T00:00:00.000Z', value: 800 },
                { dimensions: { country: 'US' }, time: '2026-08-27T00:00:00.000Z', value: 901 },
            ],
            value: 1_701,
        },
    },
    meta: {
        quality: { approximate: true, sampled: true, sampleRate: 0.25 },
        queriedAt: '2026-08-29T00:00:00.000Z',
        source: 'demo.traffic',
        temporal: { bucketTimezone: 'UTC', grain: 'day' },
    },
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

    it('uses data-only Metric Source props with inferred selections', () => {
        expectTypeOf<InsightStatProps>().not.toHaveProperty('metric')
        expectTypeOf<InsightSparklineProps>().not.toHaveProperty('metric')
        expectTypeOf<InsightBarChartProps<typeof data>>().not.toHaveProperty('metric')
        expectTypeOf<InsightBarChartProps<typeof data>['dimension']>().toEqualTypeOf<'country'>()
        expectTypeOf<InsightLineChartProps['data']>().toEqualTypeOf<MetricQueryResult>()
        expectTypeOf<InsightAreaChartProps['data']>().toEqualTypeOf<MetricQueryResult>()
        expectTypeOf<InsightBreakdownTableProps['data']>().toEqualTypeOf<MetricQueryResult>()
        expectTypeOf<InsightUIClass>().toEqualTypeOf<string | readonly string[]>()
        expectTypeOf<InsightBarChartProps['ui']>().toEqualTypeOf<InsightBarChartUI | undefined>()
        expectTypeOf<InsightSparklineProps['ui']>().toEqualTypeOf<InsightSparklineUI | undefined>()
        expectTypeOf<InsightQualityNoticeProps['ui']>().toEqualTypeOf<
            InsightQualityNoticeUI | undefined
        >()
        expectTypeOf<InsightLineChartProps>().not.toHaveProperty('metrics')
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
                    h(InsightLineChart, { data, title: 'Traffic line' }),
                    h(InsightAreaChart, { data, title: 'Traffic area' }),
                    h(InsightBarChart, {
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
                    h(InsightQualityNotice, {
                        data: data.meta.quality!,
                        ui: {
                            item: 'custom-quality-item',
                            list: 'custom-quality-list',
                            root: 'custom-quality-root',
                        },
                    }),
                ]),
            ),
        )

        expect(html).toContain('2,626')
        expect(html).toContain('Traffic line')
        expect(html).toContain('Traffic area')
        expect(html).toContain('Page Views')
        expect(html).toContain('Visits')
        expect(html).toContain('JP')
        expect(html).toContain('Results use 25% sampling')
        expect(html.match(/<svg/g)).toHaveLength(3)
        expect(html).toContain('insight-bar-chart__bar')
        expect(html).toContain('custom-bar-value')
        expect(html).toContain('custom-sparkline-path')
        expect(html).toContain('custom-quality-item')
        expect(html).toContain('data-slot="table"')
    })

    it('builds renderer-independent series and tooltip models', () => {
        const model = createSeriesModel(data, {
            colors: ['#123456', '#654321'],
            yAxis: { domain: { max: 2_000, min: 0 } },
        })
        const tooltip = createChartTooltipModel(data, model.series, 1, 'en-US', 'UTC')

        expect(model.series.map(({ metric }) => metric)).toEqual(['pageViews', 'visits'])
        expect(model.yDomain).toEqual({ min: 0, max: 2_000 })
        expect(tooltip?.values.map(({ value }) => value)).toEqual([1_386, 901])
    })
})
