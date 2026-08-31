import { bench, describe } from 'vitest'

import { createInsight, defineProvider, defineSource } from '../src/core/index.ts'
import {
    createHistory,
    type HistoryCoverage,
    type HistoryRepository,
    type HistorySegment,
} from '../src/history/index.ts'
import { defineMetricSource, type TimeRange } from '../src/metrics/index.ts'
import { cloudflare as createCloudflare } from '../src/providers/cloudflare/index.ts'
import { googleSearchConsole } from '../src/providers/google-search-console/index.ts'
import { createBreakdownModel, createSeriesModel } from '../src/ui-core/index.ts'

const time = {
    from: '2026-01-01T00:00:00.000Z',
    grain: 'hour' as const,
    to: '2026-01-08T00:00:00.000Z',
}

const coreSource = defineSource({
    execute: ({ value }: { value: number }) => ({ data: value }),
    key: ({ value }: { value: number }) => String(value),
    normalize: ({ value }: { value: number }) => ({ value }),
})
const core = createInsight({
    providers: [defineProvider({ id: 'app', sources: { value: coreSource } })],
})

describe('Core query', () => {
    bench('normalize, deduplicate, and execute a selection', async () => {
        await core.query((q) => ({
            first: q.source.app.value({ value: 1 }),
            second: q.source.app.value({ value: 1 }),
            third: q.source.app.value({ value: 2 }),
        }))
    })
})

const metrics = defineMetricSource({
    dimensions: {
        country: { operators: ['eq', 'in', 'notIn'], type: 'string' },
        status: { operators: ['eq', 'gte'], type: 'number' },
    },
    execute: () => ({ values: { errors: 1, requests: 10 } }),
    metrics: {
        errors: { aggregation: { kind: 'sum' }, rollup: 'additive' },
        requests: { aggregation: { kind: 'sum' }, rollup: 'additive' },
    },
})

describe('Metrics', () => {
    bench('normalize typed filters and time ranges', () => {
        metrics.normalize({
            dimensions: ['country'],
            metrics: ['requests', 'errors'],
            time,
            where: {
                AND: [{ country: { in: ['US', 'JP', 'US'] } }, { status: { gte: 400 } }],
            },
        })
    })
})

const materializationCases = [1, 5, 10].flatMap((metricCount) =>
    [100, 10_000].map((pointCount) => {
        const names = Array.from({ length: metricCount }, (_, index) => `metric${index}`)
        const values = Object.fromEntries(names.map((metric, index) => [metric, index]))
        const source = defineMetricSource({
            execute: () => ({
                points: Array.from({ length: pointCount }, (_, index) => ({
                    time: new Date(Date.parse(time.from) + index * 60_000).toISOString(),
                    values,
                })),
                values,
            }),
            metrics: Object.fromEntries(names.map((metric) => [metric, {}])),
        })
        return {
            metricCount,
            pointCount,
            query: source.normalize({ metrics: names, time }),
            source,
        }
    }),
)

describe('Metric materialization', () => {
    for (const fixture of materializationCases) {
        bench(`${fixture.metricCount} metrics x ${fixture.pointCount} points`, async () => {
            await fixture.source.execute(fixture.query, {
                provider: 'benchmark',
                source: 'benchmark.metrics',
            })
        })
    }
})

const historyPoints = Array.from({ length: 24 * 7 }, (_, index) => ({
    dimensions: { service: index % 2 === 0 ? 'api' : 'worker' },
    time: new Date(Date.parse(time.from) + index * 3_600_000).toISOString(),
    values: { errorRate: 0.05, errors: 5, requests: 100 },
}))
const historySource = defineMetricSource({
    dimensions: { service: 'string' },
    execute: () => ({
        points: historyPoints,
        values: { errorRate: 0.05, errors: 840, requests: 16_800 },
    }),
    history: {
        dimensions: ['service'],
        grain: 'hour',
        metrics: ['errorRate', 'errors', 'requests'],
    },
    metrics: {
        errorRate: {
            aggregation: { denominator: 'requests', kind: 'ratio', numerator: 'errors' },
            rollup: 'derived',
        },
        errors: { aggregation: { kind: 'sum' }, rollup: 'additive' },
        requests: { aggregation: { kind: 'sum' }, rollup: 'additive' },
    },
})

class BenchmarkRepository implements HistoryRepository {
    segment?: HistorySegment

    async coverage(_query: { range: TimeRange; source: string }): Promise<HistoryCoverage[]> {
        return []
    }

    async read(_query: { range: TimeRange; source: string }): Promise<HistorySegment[]> {
        return this.segment ? [this.segment] : []
    }

    async write(segment: HistorySegment): Promise<void> {
        this.segment = segment
    }
}

const repository = new BenchmarkRepository()
const history = createInsight({
    history: createHistory({
        reductions: {
            'app.metrics': [{ transformations: [{ grain: 'day', kind: 'aggregate' }] }],
        },
        repository,
        sources: ['app.metrics'],
    }),
    providers: [defineProvider({ id: 'app', sources: { metrics: historySource } })],
})

describe('History', () => {
    bench('reduce, materialize, and read a covered range', async () => {
        await history.history.sync({ range: time })
        await history.query((q) => ({
            report: q.source.app.metrics({
                dimensions: ['service'],
                metrics: ['errorRate', 'requests'],
                time: { ...time, grain: 'day' },
            }),
        }))
    })
})

const uiResult = {
    data: {
        points: Array.from({ length: 500 }, (_, index) => ({
            dimensions: { service: index % 2 === 0 ? 'api' : 'worker' },
            time: new Date(Date.parse(time.from) + index * 60_000).toISOString(),
            values: { errors: index + 1, latency: index + 2, requests: index },
        })),
        values: { errors: 501, latency: 502, requests: 500 },
    },
    meta: { queriedAt: time.to, source: 'app.metrics' },
}

describe('UI Core', () => {
    bench('build series and breakdown models', () => {
        createSeriesModel(uiResult, { colors: ['red', 'green', 'blue'] })
        createBreakdownModel(uiResult)
    })
})

const cloudflare = createCloudflare({
    accountId: 'account',
    apiToken: 'token',
    webAnalytics: {
        fetch: async () =>
            Response.json({
                data: {
                    viewer: {
                        accounts: [
                            {
                                rows: [
                                    {
                                        avg: { sampleInterval: 1 },
                                        count: 10,
                                        dimensions: { country: 'JP' },
                                        sum: { visits: 8 },
                                    },
                                ],
                            },
                        ],
                    },
                },
            }),
        siteTag: 'site',
    },
}).sources.webAnalytics
const cloudflareQuery = cloudflare.normalize({
    dimensions: ['country'],
    metrics: ['pageViews', 'visits'],
    time,
    where: { country: { in: ['JP', 'US'] } },
})
const searchConsolePayload = JSON.stringify({
    rows: Array.from({ length: 25_000 }, (_, index) => ({
        clicks: 1,
        ctr: 0.5,
        impressions: 2,
        keys: ['2026-01-01', `query-${index}`, `/page-${index}`],
        position: 3,
    })),
})
const searchConsole = googleSearchConsole({
    auth: { getAccessToken: async () => 'token' },
    fetch: async () =>
        new Response(searchConsolePayload, { headers: { 'content-type': 'application/json' } }),
    property: 'sc-domain:example.com',
}).sources.searchAnalytics
const searchConsoleQuery = searchConsole.normalize({
    dimensions: ['date', 'query', 'page'],
    limit: 25_000,
    metrics: ['clicks', 'impressions', 'ctr', 'averagePosition'],
    time,
})

describe('Provider normalization', () => {
    bench('translate and normalize a Cloudflare response', async () => {
        await cloudflare.execute(cloudflareQuery, {
            provider: 'cloudflare',
            source: 'cloudflare.webAnalytics',
        })
    })

    bench('normalize 25,000 Search Console multi-dimension rows', async () => {
        await searchConsole.execute(searchConsoleQuery, {
            provider: 'google-search-console',
            source: 'google-search-console.searchAnalytics',
        })
    })
})
