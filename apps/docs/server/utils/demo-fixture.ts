import { createInsight } from 'insight-ts'
import {
    defineMetricSource,
    type DimensionValue,
    type MetricSourceDefinition,
    type MetricSourceOutput,
    type NormalizedMetricQuery,
} from 'insight-ts/metrics'
import { defineProvider, defineSource } from 'insight-ts/provider'

const trafficValues = [
    { pageViews: 1058, visits: 692 },
    { pageViews: 1136, visits: 744 },
    { pageViews: 1198, visits: 781 },
    { pageViews: 1164, visits: 762 },
    { pageViews: 1240, visits: 812 },
    { pageViews: 1386, visits: 901 },
    { pageViews: 1421, visits: 936 },
] as const

export const createDemoTrafficSource = () =>
    defineMetricSource({
        dimensions: {
            country: { operators: ['eq', 'in'], type: 'string' },
            device: { operators: ['eq', 'in'], type: 'string' },
            path: { operators: ['eq', 'in'], type: 'string' },
            referer: { operators: ['eq', 'in'], type: 'string' },
        },
        execute: (query) =>
            metricFixture(query, trafficValues, {
                country: ['JP', 'US', 'DE', 'GB'],
                device: ['mobile', 'desktop', 'tablet'],
                path: ['/docs', '/demo', '/', '/providers/cloudflare', '/getting-started'],
                referer: ['google.com', 'github.com', 'direct', 'x.com'],
            }),
        metrics: {
            pageViews: { aggregation: { kind: 'sum' }, rollup: 'additive', unit: '{view}' },
            visits: { aggregation: { kind: 'sum' }, rollup: 'additive', unit: '{visit}' },
        },
    })

const searchSource = defineMetricSource({
    dimensions: {
        page: { operators: ['eq', 'contains'], type: 'string' },
        query: { operators: ['eq', 'contains'], type: 'string' },
    },
    execute: (query) =>
        metricFixture(
            query,
            [
                { averagePosition: 4.8, clicks: 126, ctr: 0.084, impressions: 1500 },
                { averagePosition: 5.1, clicks: 139, ctr: 0.087, impressions: 1598 },
                { averagePosition: 4.4, clicks: 151, ctr: 0.091, impressions: 1659 },
            ],
            {
                page: ['/getting-started', '/providers/cloudflare', '/demo'],
                query: ['typescript analytics', 'cloudflare web analytics', 'insight ts'],
            },
        ),
    metrics: {
        averagePosition: {
            aggregation: { kind: 'mean' },
            rollup: 'non-additive',
            unit: '{position}',
        },
        clicks: { aggregation: { kind: 'sum' }, rollup: 'additive', unit: '{click}' },
        ctr: {
            aggregation: { denominator: 'impressions', kind: 'ratio', numerator: 'clicks' },
            rollup: 'derived',
            unit: '1',
        },
        impressions: { aggregation: { kind: 'sum' }, rollup: 'additive', unit: '{impression}' },
    },
})

const productSource = defineMetricSource({
    dimensions: { plan: { operators: ['eq', 'in'], type: 'string' } },
    execute: (query) =>
        metricFixture(
            query,
            [
                { activeTeams: 318, mrr: 18400, signups: 42 },
                { activeTeams: 326, mrr: 19100, signups: 48 },
                { activeTeams: 337, mrr: 20300, signups: 51 },
            ],
            { plan: ['Pro', 'Team', 'Enterprise'] },
        ),
    metrics: {
        activeTeams: { aggregation: { kind: 'last' }, rollup: 'non-additive', unit: '{team}' },
        mrr: { aggregation: { kind: 'sum' }, rollup: 'additive', unit: 'USD' },
        signups: { aggregation: { kind: 'sum' }, rollup: 'additive', unit: '{signup}' },
    },
})

const observabilitySource = defineMetricSource({
    execute: (query) =>
        metricFixture(query, [
            { errorRate: 0.008, latencyP95: 182, requestRate: 124 },
            { errorRate: 0.011, latencyP95: 207, requestRate: 131 },
            { errorRate: 0.006, latencyP95: 169, requestRate: 128 },
        ]),
    metrics: {
        errorRate: {
            aggregation: { kind: 'provider-defined', id: 'error-rate' },
            rollup: 'non-additive',
            unit: '1',
        },
        latencyP95: {
            aggregation: { kind: 'percentile', quantile: 0.95 },
            rollup: 'non-additive',
            unit: 'ms',
        },
        requestRate: { aggregation: { kind: 'mean' }, rollup: 'non-additive', unit: '{request}/s' },
    },
})

const funnelSource = defineSource({
    execute: async () => ({
        data: {
            steps: [
                { converted: 10_000, name: 'Visited', rate: 1 },
                { converted: 2_840, name: 'Signed up', rate: 0.284 },
                { converted: 1_036, name: 'Activated', rate: 0.104 },
                { converted: 386, name: 'Upgraded', rate: 0.039 },
            ],
        },
    }),
    key: ({ from, to }) => `${from}:${to}`,
    normalize: (query: { time: DemoReportQuery['range'] }) => query.time,
})

const logsSource = defineSource({
    execute: async (query: { cursor: string; limit: number }) => ({
        data: {
            entries: [
                {
                    level: 'info' as const,
                    message: 'Deployment completed',
                    timestamp: '2026-08-29T02:16:00.000Z',
                },
                {
                    level: 'warn' as const,
                    message: 'Queue latency exceeded 200ms',
                    timestamp: '2026-08-29T02:13:00.000Z',
                },
                {
                    level: 'error' as const,
                    message: 'Checkout request timed out',
                    timestamp: '2026-08-29T02:09:00.000Z',
                },
            ].slice(0, query.limit),
        },
        meta: { nextCursor: 'demo-page-2' },
    }),
    key: ({ cursor, limit }) => `${cursor}:${limit}`,
    normalize: (query: { cursor?: string; limit?: number }) => ({
        cursor: query.cursor ?? '',
        limit: Math.max(1, Math.min(query.limit ?? 3, 20)),
    }),
})

const traceSource = defineSource({
    execute: async ({ traceId }: { traceId: string }) => ({
        data: {
            edges: [
                { from: 'root', to: 'api' },
                { from: 'api', to: 'db' },
                { from: 'api', to: 'cache' },
            ],
            spans: [
                { durationMs: 243, id: 'root', name: 'GET /checkout' },
                { durationMs: 196, id: 'api', name: 'checkout.create', parentId: 'root' },
                { durationMs: 121, id: 'db', name: 'postgres INSERT', parentId: 'api' },
                { durationMs: 18, id: 'cache', name: 'redis GET', parentId: 'api' },
            ],
            traceId,
        },
    }),
    key: ({ traceId }) => traceId,
    normalize: (query: { traceId: string }) => ({ traceId: query.traceId.trim() }),
})

const billingSource = defineSource({
    execute: async () => ({
        data: {
            currency: 'USD' as const,
            invoices: [
                { amount: 8900, customer: 'Acme', status: 'paid' as const },
                { amount: 4200, customer: 'Globex', status: 'open' as const },
                { amount: 3100, customer: 'Initech', status: 'paid' as const },
            ],
            outstanding: 4200,
            revenue: 16_200,
        },
    }),
    key: ({ from, to }) => `${from}:${to}`,
    normalize: (query: { time: DemoReportQuery['range'] }) => query.time,
})

export const createDemoProvider = () =>
    defineProvider({
        id: 'demo',
        sources: {
            billing: billingSource,
            funnel: funnelSource,
            logs: logsSource,
            observability: observabilitySource,
            product: productSource,
            searchConsole: searchSource,
            trace: traceSource,
        },
    })

export async function createDemoFixture(
    query: DemoReportQuery,
    now = new Date(),
): Promise<DemoReportResponse> {
    return executeDemoQuery(createDemoTrafficSource(), query, now)
}

export async function executeDemoQuery(
    trafficSource: MetricSourceDefinition,
    query: DemoReportQuery,
    now = new Date(),
): Promise<DemoReportResponse> {
    const insight = createInsight({
        now: () => now,
        providers: [
            defineProvider({ id: 'cloudflare', sources: { webAnalytics: trafficSource } }),
            createDemoProvider(),
        ] as const,
    })
    const recent = {
        from: new Date(now.valueOf() - 5 * 60 * 1000).toISOString(),
        to: now.toISOString(),
    }
    const result = await insight.query((q) => ({
        billing: q.source('demo.billing', { time: query.range }),
        countries: q.source('cloudflare.webAnalytics', {
            dimensions: ['country'],
            limit: 4,
            metrics: ['pageViews'],
            time: query.range,
        }),
        devices: q.source('cloudflare.webAnalytics', {
            dimensions: ['device'],
            limit: 3,
            metrics: ['visits'],
            time: query.range,
        }),
        funnel: q.source('demo.funnel', { time: query.range }),
        logs: q.source('demo.logs', { limit: 3 }),
        observabilitySeries: q.source('demo.observability', {
            metrics: ['requestRate', 'errorRate', 'latencyP95'],
            time: { ...query.range, grain: query.grain },
        }),
        observabilitySummary: q.source('demo.observability', {
            metrics: ['requestRate', 'errorRate', 'latencyP95'],
            time: query.range,
        }),
        productRevenue: q.source('demo.product', {
            dimensions: ['plan'],
            metrics: ['mrr'],
            time: query.range,
        }),
        productSeries: q.source('demo.product', {
            metrics: ['signups', 'activeTeams'],
            time: { ...query.range, grain: query.grain },
        }),
        productSummary: q.source('demo.product', {
            metrics: ['signups', 'activeTeams'],
            time: query.range,
        }),
        recentTraffic: q.source('cloudflare.webAnalytics', { metrics: ['visits'], time: recent }),
        referrers: q.source('cloudflare.webAnalytics', {
            dimensions: ['referer'],
            limit: 4,
            metrics: ['visits'],
            time: query.range,
        }),
        searchPages: q.source('demo.searchConsole', {
            dimensions: ['page'],
            limit: 3,
            metrics: ['clicks', 'impressions'],
            time: query.range,
        }),
        searchQueries: q.source('demo.searchConsole', {
            dimensions: ['query'],
            limit: 3,
            metrics: ['clicks', 'impressions'],
            time: query.range,
        }),
        searchSeries: q.source('demo.searchConsole', {
            metrics: ['clicks', 'impressions', 'ctr'],
            time: { ...query.range, grain: query.grain },
        }),
        searchSummary: q.source('demo.searchConsole', {
            metrics: ['clicks', 'impressions', 'ctr', 'averagePosition'],
            time: query.range,
        }),
        topPages: q.source('cloudflare.webAnalytics', {
            dimensions: ['path'],
            limit: 5,
            metrics: ['pageViews'],
            time: query.range,
        }),
        trace: q.source('demo.trace', { traceId: '4bf92f3577b34da6a3ce929d0e0e4736' }),
        trafficSeries: q.source('cloudflare.webAnalytics', {
            metrics: ['pageViews', 'visits'],
            time: { ...query.range, grain: query.grain },
        }),
        trafficSummary: q.source('cloudflare.webAnalytics', {
            metrics: ['pageViews', 'visits'],
            time: query.range,
        }),
    }))
    return {
        analytics: {
            countries: result.countries,
            devices: result.devices,
            referrers: result.referrers,
            searchPages: result.searchPages,
            searchQueries: result.searchQueries,
            searchSeries: result.searchSeries,
            searchSummary: result.searchSummary,
            topPages: result.topPages,
            trafficSeries: result.trafficSeries,
            trafficSummary: result.trafficSummary,
        },
        billing: result.billing,
        execution: { queriedAt: now.toISOString(), sources: insight.sources().map(({ id }) => id) },
        funnel: result.funnel,
        logs: result.logs,
        observability: { series: result.observabilitySeries, summary: result.observabilitySummary },
        online: Math.max(0, Math.round(result.recentTraffic.data.visits?.value ?? 0)),
        product: {
            revenue: result.productRevenue,
            series: result.productSeries,
            summary: result.productSummary,
        },
        trace: result.trace,
    }
}

function metricFixture(
    query: NormalizedMetricQuery,
    values: readonly Readonly<Record<string, number>>[],
    dimensions: Readonly<Record<string, readonly DimensionValue[]>> = {},
): MetricSourceOutput {
    const rows =
        query.dimensions.length > 0
            ? Array.from(
                  {
                      length: Math.min(
                          query.limit ?? 5,
                          Math.max(
                              ...query.dimensions.map((field) => dimensions[field]?.length ?? 0),
                              1,
                          ),
                      ),
                  },
                  (_, index) => ({
                      dimensions: Object.fromEntries(
                          query.dimensions.map((field) => [
                              field,
                              dimensions[field]?.[index % (dimensions[field]?.length ?? 1)] ?? null,
                          ]),
                      ),
                      values: selectedValues(query, values[index % values.length]!),
                  }),
              )
            : query.grain === 'auto'
              ? []
              : timePoints(query).map((time, index) => ({
                    time,
                    values: selectedValues(query, values[index % values.length]!),
                }))
    return {
        ...(rows.length > 0 ? { points: rows } : {}),
        values: selectedValues(query, values.at(-1)!),
    }
}

const selectedValues = (query: NormalizedMetricQuery, row: Readonly<Record<string, number>>) =>
    Object.fromEntries(query.metrics.map((metric) => [metric, row[metric] ?? null]))

function timePoints(query: NormalizedMetricQuery): string[] {
    const points: string[] = []
    for (
        let value = new Date(query.time.from), index = 0;
        value < new Date(query.time.to) && index < 120;
        value = next(value, query.grain), index++
    ) {
        points.push(value.toISOString())
    }
    return points
}

function next(value: Date, grain: NormalizedMetricQuery['grain']): Date {
    const date = new Date(value)
    if (grain === 'minute') date.setUTCMinutes(date.getUTCMinutes() + 1)
    else if (grain === 'hour') date.setUTCHours(date.getUTCHours() + 1)
    else if (grain === 'day' || grain === 'auto') date.setUTCDate(date.getUTCDate() + 1)
    else if (grain === 'week') date.setUTCDate(date.getUTCDate() + 7)
    else if (grain === 'month') date.setUTCMonth(date.getUTCMonth() + 1)
    else date.setUTCFullYear(date.getUTCFullYear() + 1)
    return date
}
