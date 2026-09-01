import { createInsight, defineProvider } from '../src/core/index.ts'
import { defineMetricAdapter } from '../src/metrics/index.ts'
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
    const result = await insight.query((q) => ({
        usage: q.metrics({
            dimensions: ['country'],
            metrics: ['requests'],
            time,
            where: { country: { in: ['JP'] } },
        }),
    }))
    const requests: number | null | undefined = result.usage.data.values.requests
    void requests

    scoped.scope('production')
    // @ts-expect-error Scope names are inferred as literals
    scoped.scope('preview')
    // @ts-expect-error unsupported Metric names are rejected
    await insight.query((q) => ({ invalid: q.metrics({ metrics: ['errors'], time }) }))
    await insight.query((q) => ({
        // @ts-expect-error unsupported dimensions are rejected
        invalid: q.metrics({ dimensions: ['service'], metrics: ['requests'], time }),
    }))
    // @ts-expect-error Provider/Source accessors are not part of the canonical query DSL
    await insight.query((q) => ({ invalid: q.source.app.usage({}) }))
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
