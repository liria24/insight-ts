import { createInsight, defineProvider } from '../src/core/index.ts'
import { defineMetricAdapter, type MetricQuery } from '../src/metrics/index.ts'
import {
    googleSearchConsole,
    type GoogleSearchConsoleOptions,
} from '../src/providers/google-search-console/index.ts'

const time = { from: '2026-08-01', to: '2026-08-02' }
const provider = defineProvider({
    adapters: {
        usage: defineMetricAdapter({
            dimensions: { country: 'string' },
            execute: () => ({ values: { requests: 1 } }),
            metrics: { requests: {} },
        }),
    },
    id: 'app',
})
const insight = createInsight({ providers: [provider] })
const scoped = createInsight({ scopes: { production: [provider], staging: [provider] } })

async function verifyPublicTypes() {
    const result = await insight.metrics({
        dimensions: ['country'],
        metrics: ['requests'],
        time,
        where: { country: { in: ['JP'] } },
    })
    const requests: number | null | undefined = result.aggregate.requests
    void requests

    const aggregate = await insight.metrics({
        metrics: ['requests'],
        projection: 'aggregate',
        time,
    })
    const rows = await insight.metrics({
        dimensions: ['country'],
        metrics: ['requests'],
        projection: 'rows',
        time,
    })
    const both = await insight.metrics({
        dimensions: ['country'],
        metrics: ['requests'],
        projection: 'both',
        time,
    })
    void aggregate.aggregate.requests
    void rows.rows[0]?.values.requests
    void both.aggregate.requests
    void both.rows
    // @ts-expect-error aggregate-only results do not expose rows
    void aggregate.rows
    // @ts-expect-error rows-only results do not expose aggregate
    void rows.aggregate

    const dynamicQuery: MetricQuery<{ requests: Record<never, never> }, { country: 'string' }> = {
        metrics: ['requests'],
        projection: Math.random() > 0.5 ? 'aggregate' : 'rows',
        time,
    }
    const dynamic = await insight.metrics(dynamicQuery)
    // @ts-expect-error a dynamic projection does not guarantee either field
    void dynamic.aggregate
    // @ts-expect-error a dynamic projection does not guarantee either field
    void dynamic.rows

    await scoped.scope('production').metrics({ metrics: ['requests'], time })
    // @ts-expect-error Scope names are inferred as literals
    scoped.scope('preview')
    // @ts-expect-error unsupported Metric names are rejected
    await insight.metrics({ metrics: ['errors'], time })
    // @ts-expect-error unsupported dimensions are rejected
    await insight.metrics({ dimensions: ['service'], metrics: ['requests'], time })
    // @ts-expect-error Provider/Source accessors are not part of the canonical API
    insight.source.app.usage({})
    // @ts-expect-error obsolete selection API is not exported
    void insight.query
    // @ts-expect-error obsolete report access is not exported
    insight.reports('app.usage')
}

const advanced: GoogleSearchConsoleOptions = {
    advanced: { maxRows: 500_000 },
    auth: { getAccessToken: async () => 'token' },
    property: 'sc-domain:example.com',
}
googleSearchConsole(advanced)

const obsolete: GoogleSearchConsoleOptions = {
    auth: { getAccessToken: async () => 'token' },
    // @ts-expect-error execution tuning is not a top-level Provider option
    maxRows: 500_000,
    property: 'sc-domain:example.com',
}

void obsolete
void verifyPublicTypes
