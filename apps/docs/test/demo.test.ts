import { describe, expect, it } from 'bun:test'

import { createDemoFixture } from '../server/utils/demo-fixture'
import { resolveDemoReportQuery } from '../shared/utils/demo-range'

const now = new Date('2026-08-21T12:00:00.000Z')

describe('Demo analytics range', () => {
    it('renders direct MDC examples with literal data on every UI page', async () => {
        const pages = {
            '2.stat.md': { fixture: 'values: { pageViews: 4140 }', tag: 'insight-stat' },
            '3.line-chart.md': {
                fixture: 'values: { pageViews: 4140 }',
                tag: 'insight-line-chart',
            },
            '4.area-chart.md': {
                fixture: 'values: { pageViews: 4140 }',
                tag: 'insight-area-chart',
            },
            '5.breakdown-table.md': {
                fixture: 'values: { pageViews: 4140 }',
                tag: 'insight-breakdown-table',
            },
            '6.bar-chart.md': { fixture: 'values: { pageViews: 4140 }', tag: 'insight-bar-chart' },
            '7.sparkline.md': { fixture: 'values: { pageViews: 4140 }', tag: 'insight-sparkline' },
            '8.quality-notice.md': {
                fixture: 'sampleRate: 0.25',
                tag: 'insight-quality-notice',
            },
        } as const
        await Promise.all(
            Object.entries(pages).map(async ([file, { fixture, tag }]) => {
                const content = await Bun.file(
                    new URL(`../content/5.ui/${file}`, import.meta.url),
                ).text()
                const example = content.slice(
                    content.indexOf('## Example'),
                    content.indexOf('## Usage'),
                )
                expect(example).toContain(`:::${tag}{:data='`)
                expect(example).toContain(fixture)
                expect(example).toContain('#code')
                expect(example).not.toContain('dashboard.')
                expect(example).not.toContain('\n---')
                expect(example).not.toContain('insight-ui-preview')
                expect(content).toContain('## Props')
                expect(content).toContain('## Customization')
            }),
        )
        const registration = await Bun.file(
            new URL('../app/plugins/insight-ui.ts', import.meta.url),
        ).text()
        for (const component of [
            'InsightAreaChart',
            'InsightBarChart',
            'InsightBreakdownTable',
            'InsightLineChart',
            'InsightQualityNotice',
            'InsightSparkline',
            'InsightStat',
        ]) {
            expect(registration).toContain(`vueApp.component('${component}'`)
        }
    })
    it('renders Metric results through data-only public UI', async () => {
        const [source, dashboard] = await Promise.all([
            Bun.file(new URL('../app/pages/demo.vue', import.meta.url)).text(),
            Bun.file(new URL('../app/components/InsightDemoDashboard.vue', import.meta.url)).text(),
        ])

        expect(source).toContain('await useFetch<DemoReportResponse>')
        expect(source).toContain('InsightDemoDashboard')
        expect(dashboard).toContain('InsightAreaChart')
        expect(dashboard).toContain('InsightBarChart')
        expect(dashboard).toContain('InsightSparkline')
        expect(dashboard).toContain('InsightQualityNotice')
        expect(dashboard).toContain("from 'insight-ts/vue/ui'")
        expect(dashboard).toContain(':data=')
        expect(dashboard).not.toContain(':report=')
        expect(dashboard).not.toContain(':metrics=')
        expect(dashboard).not.toContain('metric="')
        expect(source).not.toContain('useLazyFetch')
        expect(source).not.toContain('server: false')
    })

    it('keeps code-preview source on one scrollable line', async () => {
        const config = await Bun.file(new URL('../app/app.config.ts', import.meta.url)).text()

        expect(config).toContain('[&>div>pre]:whitespace-pre')
        expect(config).toContain('[&>div>pre]:wrap-normal')
    })

    it('reuses the report dashboard on the landing page with a fixed seven-day range', async () => {
        const source = await Bun.file(
            new URL('../app/components/landing/LandingDemo.vue', import.meta.url),
        ).text()

        expect(source).toContain("query: { range: '7d' }")
        expect(source).toContain('InsightDemoDashboard compact')
        expect(source).toContain('Explore the live demo')
    })

    it('resolves presets and executes deterministic demo Sources through insight.query', async () => {
        const query = resolveDemoReportQuery({ range: '7d' }, now)
        const result = await createDemoFixture(query, now)
        const pageViews = result.analytics.trafficSeries.data.points ?? []

        expect(query).toEqual({
            grain: 'day',
            range: {
                from: '2026-08-14T12:00:00.000Z',
                to: '2026-08-21T12:00:00.000Z',
            },
        })
        expect(pageViews).toHaveLength(7)
        expect(result.online).toBeGreaterThan(0)
        expect(result.analytics.trafficSummary.data.values.pageViews).toBe(1421)
        expect(result.execution.capabilities).toContain('logs')
        expect(result.logs.data.logs).toHaveLength(3)
        expect(result.trace.data.traces[0]?.spans).toHaveLength(4)
    })

    it('keeps Source-owned renderers demo-local and shows all five sections', async () => {
        const [dashboard, owned, fixture, endpoint] = await Promise.all([
            Bun.file(new URL('../app/components/InsightDemoDashboard.vue', import.meta.url)).text(),
            Bun.file(
                new URL('../app/components/DemoOwnedSourceResults.vue', import.meta.url),
            ).text(),
            Bun.file(new URL('../server/utils/demo-fixture.ts', import.meta.url)).text(),
            Bun.file(new URL('../server/api/demo.get.ts', import.meta.url)).text(),
        ])
        for (const section of [
            'Overview',
            'Analytics',
            'Product &amp; Revenue',
            'Observability',
            'Data &amp; Execution',
        ]) {
            expect(dashboard).toContain(section)
        }
        expect(owned).toContain('Paginated logs')
        expect(owned).toContain('Trace graph')
        expect(fixture).toContain('defineMetricAdapter')
        expect(fixture).toContain('defineLogAdapter')
        expect(fixture).toContain('defineTraceAdapter')
        expect(fixture).toContain('insight.query')
        expect(endpoint).toContain('createDemoFixture')
        expect(endpoint).not.toContain('Provider fallback')
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
