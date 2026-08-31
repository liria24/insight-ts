import { describe, expect, expectTypeOf, it, vi } from 'vitest'

import {
    createInsight,
    defineProvider,
    defineSource,
    type DataOf,
    type EventDestination,
    type EventProperties,
    type Instrumentation,
    type ProviderExecutionRequest,
    type QueryResult,
    type QueryOf,
    type SourceExecutionResult,
} from '../src/core/index.ts'
import { defineMetricSource, type MetricData } from '../src/metrics/index.ts'

const range = {
    from: '2026-08-01T00:00:00.000Z',
    to: '2026-08-02T00:00:00.000Z',
} as const

const metricSource = defineMetricSource({
    dimensions: {
        country: { operators: ['eq', 'in'] as const, type: 'string' },
        latency: { operators: ['gt', 'lte'] as const, type: 'number' },
    },
    execute: async (query) => ({
        quality: { sampled: true, sampleRate: 0.5 },
        values: Object.fromEntries(query.metrics.map((metric) => [metric, 7])),
    }),
    metrics: {
        requests: { aggregation: { kind: 'sum' }, rollup: 'additive', unit: '{request}' },
    },
})

const logsSource = defineSource({
    execute: async (query: { cursor: string }) => ({
        data: { entries: [{ message: 'ready' }], nextCursor: query.cursor || 'page-2' },
    }),
    key: (query) => query.cursor,
    normalize: (query: { cursor?: string }) => ({ cursor: query.cursor ?? '' }),
})

const traceSource = defineSource({
    execute: async (query: { traceId: string }) => ({
        data: { edges: [['root', 'db']] as const, traceId: query.traceId },
    }),
    key: ({ traceId }) => traceId,
    normalize: (query: { traceId: string }) => ({ traceId: query.traceId.trim() }),
})

const funnelSource = defineSource({
    execute: async () => ({ data: { steps: [{ converted: 10, name: 'Visit' }] } }),
    key: () => 'current',
    normalize: (_query: { window: '7d' | '30d' }) => ({ window: '7d' as const }),
})

const billingSource = defineSource({
    execute: async ({ customer }: { customer: string }) => ({
        data: { balance: 1250, currency: 'JPY' as const, customer },
    }),
    key: ({ customer }) => customer,
    normalize: (query: { customer: string }) => ({ customer: query.customer.trim() }),
})

expectTypeOf<DataOf<typeof logsSource>>().toEqualTypeOf<{
    entries: { message: string }[]
    nextCursor: string
}>()
expectTypeOf<QueryOf<typeof logsSource>>().toEqualTypeOf<{ cursor?: string }>()

describe('generic Source query execution', () => {
    it('infers heterogeneous Source results without a Core ontology', async () => {
        const insight = createInsight({
            now: () => new Date('2026-08-29T00:00:00.000Z'),
            providers: [
                defineProvider({
                    id: 'demo',
                    sources: {
                        billing: billingSource,
                        funnel: funnelSource,
                        logs: logsSource,
                        metrics: metricSource,
                        trace: traceSource,
                    },
                }),
            ],
        })
        const dashboard = await insight.query((q) => ({
            billing: q.source.demo.billing({ customer: ' acme ' }),
            funnel: q.source.demo.funnel({ window: '7d' }),
            logs: q.source.demo.logs({}),
            metrics: q.source.demo.metrics({ metrics: ['requests'], time: range }),
            trace: q.source.demo.trace({ traceId: ' trace-1 ' }),
        }))

        expectTypeOf(dashboard.logs.data.entries[0]!.message).toEqualTypeOf<string>()
        expectTypeOf(dashboard.trace.data.edges).toEqualTypeOf<readonly [readonly ['root', 'db']]>()
        expectTypeOf(dashboard.billing.data.currency).toEqualTypeOf<'JPY'>()
        expectTypeOf(dashboard.metrics.data).toEqualTypeOf<MetricData<'requests', never>>()
        expect(dashboard).toMatchObject({
            billing: { data: { customer: 'acme' }, meta: { source: 'demo.billing' } },
            logs: { data: { nextCursor: 'page-2' }, meta: { source: 'demo.logs' } },
            metrics: { meta: { quality: { sampleRate: 0.5, sampled: true } } },
        })
        expect(insight.sources()).toEqual([
            { id: 'demo.billing', provider: 'demo' },
            { id: 'demo.funnel', provider: 'demo' },
            { id: 'demo.logs', provider: 'demo' },
            { id: 'demo.metrics', provider: 'demo' },
            { id: 'demo.trace', provider: 'demo' },
        ])
    })

    it('normalizes before exact dedupe and batches once per Provider', async () => {
        const execute = vi.fn<
            (
                requests: readonly ProviderExecutionRequest[],
            ) => Promise<readonly SourceExecutionResult<unknown, object>[]>
        >(
            async (
                requests: readonly ProviderExecutionRequest[],
            ): Promise<readonly SourceExecutionResult<unknown, object>[]> =>
                Promise.all(requests.map((request) => request.execute())),
        )
        const sourceExecute = vi.fn<typeof logsSource.execute>((query, context) =>
            logsSource.execute(query, context),
        )
        const source = { ...logsSource, execute: sourceExecute }
        const insight = createInsight({
            providers: [defineProvider({ execute, id: 'batched', sources: { logs: source } })],
        })

        const result = await insight.query((q) => ({
            first: q.source.batched.logs({}),
            second: q.source.batched.logs({ cursor: '' }),
        }))

        expect(execute).toHaveBeenCalledOnce()
        expect(execute.mock.calls[0]?.[0]).toHaveLength(1)
        expect(sourceExecute).toHaveBeenCalledOnce()
        expect(result.first).toBe(result.second)
    })

    it('keeps AbortSignal at execution scope', async () => {
        const execute = vi.fn<typeof logsSource.execute>((query, context) =>
            logsSource.execute(query, context),
        )
        const insight = createInsight({
            providers: [
                defineProvider({ id: 'abort', sources: { logs: { ...logsSource, execute } } }),
            ],
        })
        const controller = new AbortController()
        controller.abort(new Error('stop'))

        await expect(
            insight.query((q) => ({ logs: q.source.abort.logs({}) }), {
                signal: controller.signal,
            }),
        ).rejects.toThrow('stop')
        expect(execute).not.toHaveBeenCalled()
    })
})

describe('Source accessors', () => {
    it('maps canonical Provider ids once and keeps prototype-sensitive names safe', async () => {
        const insight = createInsight({
            providers: [
                defineProvider({
                    id: 'google-search-console',
                    sources: { searchAnalytics: logsSource },
                }),
                defineProvider({ id: 'provider-2', sources: { logs: logsSource } }),
                defineProvider({ id: 'to-string', sources: { constructor: logsSource } }),
            ],
        })

        const result = await insight.query((q) => ({
            numeric: q.source.provider2.logs({}),
            prototype: q.source.toString.constructor({}),
            search: q.source.googleSearchConsole.searchAnalytics({}),
        }))

        expect(result.numeric.meta.source).toBe('provider-2.logs')
        expect(result.prototype.meta.source).toBe('to-string.constructor')
        expect(result.search.meta.source).toBe('google-search-console.searchAnalytics')
    })

    it.each([
        'my.provider',
        'my#provider',
        'my provider',
        'my_provider',
        '-my-provider',
        'my-provider-',
        'my--provider',
        '123-provider',
        'プロバイダ',
    ])('rejects invalid Provider id %s', (id) => {
        expect(() => createInsight({ providers: [{ id, sources: { logs: logsSource } }] })).toThrow(
            'strict ASCII kebab-case',
        )
    })

    it('rejects accessor collisions', () => {
        expect(() =>
            createInsight({
                providers: [
                    { id: 'foo-1', sources: { logs: logsSource } },
                    { id: 'foo1', sources: { logs: logsSource } },
                ],
            }),
        ).toThrow('both map to accessor "foo1"')
    })

    it.each(['Search', 'search-source', 'search.source', 'search source', '検索', '1search'])(
        'rejects invalid Source key %s',
        (key) => {
            expect(() =>
                createInsight({ providers: [{ id: 'app', sources: { [key]: logsSource } }] }),
            ).toThrow('lower-camel-case ASCII identifier')
        },
    )
})

describe('Metric where DSL', () => {
    it('canonicalizes equivalent shorthand and operator forms to the same key', () => {
        const shorthand = metricSource.normalize({
            metrics: ['requests'],
            time: range,
            where: { country: 'JP' },
        })
        const explicit = metricSource.normalize({
            metrics: ['requests'],
            time: range,
            where: { country: { eq: 'JP' } },
        })
        expect(metricSource.key(shorthand)).toBe(metricSource.key(explicit))
        expect(shorthand.where).toEqual({ field: 'country', operator: 'eq', value: 'JP' })
    })

    it('derives operator values from each dimension schema', () => {
        expect(() =>
            metricSource.normalize({
                metrics: ['requests'],
                time: range,
                where: { AND: [{ country: { in: ['JP', 'US'] } }, { latency: { gt: 10 } }] },
            }),
        ).not.toThrow()
        const invalidQueries = () => {
            metricSource.normalize({
                metrics: ['requests'],
                time: range,
                // @ts-expect-error country does not expose numeric comparison operators
                where: { country: { gt: 10 } },
            })
            metricSource.normalize({
                metrics: ['requests'],
                time: range,
                // @ts-expect-error latency comparisons require numbers
                where: { latency: { gt: 'slow' } },
            })
        }
        void invalidQueries
    })
})

describe('events and instrumentation', () => {
    it('adds active trace context without exposing query values as attributes', async () => {
        const track = vi.fn<EventDestination['track']>()
        const calls: {
            attributes: Readonly<Record<string, boolean | number | string>>
            name: string
        }[] = []
        const instrumentation: Instrumentation = {
            activeTraceContext: () => ({ spanId: 'span', traceId: 'trace' }),
            async run(name, attributes, operation) {
                calls.push({ attributes, name })
                return operation({ recordException() {}, setAttribute() {} })
            },
        }
        const options = {
            events: { search: { properties: { resultCount: 'number' } } },
            instrumentation,
            providers: [
                { events: { track }, id: 'events', sources: { logs: logsSource } },
            ] as const,
        } as const
        type SearchProperties = EventProperties<typeof options, 'search'>
        expectTypeOf<SearchProperties>().toEqualTypeOf<{ readonly resultCount: number }>()
        const insight = createInsight(options)

        await insight.query((q) => ({ secret: q.source.events.logs({ cursor: 'private' }) }))
        await insight.track('search', { resultCount: 4 })

        expect(track).toHaveBeenCalledWith(
            expect.objectContaining({
                context: { spanId: 'span', traceId: 'trace' },
                name: 'search',
            }),
        )
        expect(JSON.stringify(calls)).not.toContain('private')
        expect(calls.map(({ name }) => name)).toEqual([
            'insight.query',
            'insight.provider.execute',
            'insight.event.track',
        ])
    })
})

expectTypeOf<QueryResult<{ value: number }>>().toMatchTypeOf<QueryResult<unknown>>()
