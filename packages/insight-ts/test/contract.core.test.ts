/* eslint-disable typescript/unbound-method, unicorn/consistent-function-scoping, vitest/require-mock-type-parameters */

import { describe, expect, expectTypeOf, it, vi } from 'vitest'

import {
    createInsight,
    defineProvider,
    type AdapterExecutionResult,
    type CapabilityAdapterDefinition,
    type CapabilityContract,
    type CapabilitySchema,
    type EventDestination,
    type EventProperties,
    type HistoryExtension,
    type Instrumentation,
    type ProviderExecutionRequest,
    type QueryResult,
} from '../src/core/index.ts'
import { defineMetricAdapter, type MetricData, type TimeRange } from '../src/metrics/index.ts'

const time = {
    from: '2026-08-01T00:00:00.000Z',
    to: '2026-08-02T00:00:00.000Z',
} satisfies TimeRange

const usageContract: CapabilityContract<'usage', { account: string }> = {
    key: ({ account }) => account,
    merge: (_query, [contribution]) => ({
        data: contribution?.result.data ?? { spent: 0 },
    }),
    name: 'usage',
    normalize(input) {
        if (
            typeof input !== 'object' ||
            input === null ||
            !('account' in input) ||
            typeof input.account !== 'string'
        ) {
            throw new TypeError('Usage query requires an account')
        }
        return { account: input.account }
    },
    plan: (query) => query,
}

const usageAdapter: CapabilityAdapterDefinition<
    'usage',
    CapabilitySchema<{ account: string }, { spent: number }>,
    { account: string },
    { account: string },
    { spent: number }
> = {
    contract: usageContract,
    execute: ({ account }) => ({ data: { spent: account.length } }),
    key: ({ account }) => account,
    normalize: (query) => query,
}

describe('canonical query planning', () => {
    it('fans one Metric query across adapters and merges rows deterministically', async () => {
        const requests = vi.fn(() => ({
            points: [
                {
                    dimensions: { country: 'JP' },
                    time: '2026-08-01T01:00:00Z',
                    values: { requests: 7 },
                },
            ],
            quality: { sampled: true, sampleRate: 0.5 },
            values: { requests: 7 },
        }))
        const errors = vi.fn(() => ({
            points: [
                {
                    dimensions: { country: 'JP' },
                    time: '2026-08-01T01:00:00Z',
                    values: { errors: 1 },
                },
            ],
            values: { errors: 1 },
        }))
        const insight = createInsight({
            now: () => new Date('2026-08-02T00:00:00Z'),
            providers: [
                defineProvider({
                    adapters: {
                        traffic: defineMetricAdapter({
                            dimensions: { country: 'string' },
                            execute: requests,
                            metrics: { requests: {} },
                        }),
                    },
                    id: 'traffic',
                }),
                defineProvider({
                    adapters: {
                        errors: defineMetricAdapter({
                            dimensions: { country: 'string' },
                            execute: errors,
                            metrics: { errors: {} },
                        }),
                    },
                    id: 'observability',
                }),
            ],
        })

        const result = await insight.metrics({
            dimensions: ['country'],
            metrics: ['requests', 'errors'],
            time,
        })

        expectTypeOf(result).toMatchTypeOf<QueryResult<MetricData>>()
        expect(requests).toHaveBeenCalledOnce()
        expect(errors).toHaveBeenCalledOnce()
        expect(result).toEqual({
            aggregate: { errors: 1, requests: 7 },
            meta: {
                quality: { sampled: true, sampleRate: 0.5 },
                queriedAt: '2026-08-02T00:00:00.000Z',
            },
            rows: [
                {
                    dimensions: { country: 'JP' },
                    time: '2026-08-01T01:00:00.000Z',
                    values: { errors: 1, requests: 7 },
                },
            ],
        })
    })

    it('rejects incompatible cross-adapter dimensions before I/O', async () => {
        const execute = vi.fn(() => ({ values: { requests: 1 } }))
        const insight = createInsight({
            providers: [
                defineProvider({
                    adapters: {
                        first: defineMetricAdapter({
                            dimensions: { country: 'string' },
                            execute,
                            metrics: { requests: {} },
                        }),
                    },
                    id: 'first',
                }),
                defineProvider({
                    adapters: {
                        second: defineMetricAdapter({
                            execute: () => ({ values: { errors: 1 } }),
                            metrics: { errors: {} },
                        }),
                    },
                    id: 'second',
                }),
            ],
        })

        await expect(
            insight.metrics({
                dimensions: ['country'],
                metrics: ['requests', 'errors'],
                time,
            }),
        ).rejects.toMatchObject({ code: 'UNSUPPORTED_DIMENSION' })
        expect(execute).not.toHaveBeenCalled()
    })

    it('uses ordinary Promise concurrency for independent queries', async () => {
        const adapter = defineMetricAdapter({
            execute: ({ metrics }) => ({
                values: Object.fromEntries(metrics.map((key) => [key, 1])),
            }),
            metrics: { requests: {} },
        })
        const execute = vi.fn(
            async (
                requests: readonly ProviderExecutionRequest[],
            ): Promise<readonly AdapterExecutionResult<unknown, object>[]> =>
                Promise.all(requests.map(({ execute: run }) => run())),
        )
        const insight = createInsight({
            providers: [defineProvider({ adapters: { traffic: adapter }, execute, id: 'batched' })],
        })

        const [first, second] = await Promise.all([
            insight.metrics({ metrics: ['requests'], time }),
            insight.metrics({ metrics: ['requests'], time }),
        ])

        expect(execute).toHaveBeenCalledTimes(2)
        expect(execute.mock.calls.every(([requests]) => requests.length === 1)).toBe(true)
        expect(first.aggregate).toEqual(second.aggregate)
    })

    it('exposes custom capabilities directly and reserves client method names', async () => {
        const insight = createInsight({
            providers: [defineProvider({ adapters: { usage: usageAdapter }, id: 'app' })],
        })

        const result = await insight.usage({ account: 'acme' })

        expectTypeOf(result.spent).toEqualTypeOf<number>()
        expect(result.spent).toBe(4)
        for (const name of ['history', 'next', 'scope', 'then', 'track']) {
            expect(() =>
                createInsight({
                    providers: [
                        defineProvider({
                            adapters: {
                                reserved: {
                                    ...usageAdapter,
                                    contract: { ...usageContract, name },
                                },
                            },
                            id: 'app',
                        }),
                    ],
                }),
            ).toThrow('reserved')
        }
    })

    it('rejects capability data that collides with public metadata', async () => {
        const insight = createInsight({
            providers: [
                defineProvider({
                    adapters: {
                        usage: {
                            ...usageAdapter,
                            contract: {
                                ...usageContract,
                                merge: () => ({ data: { meta: 'private' } }),
                            },
                        },
                    },
                    id: 'app',
                }),
            ],
        })

        await expect(insight.usage({ account: 'acme' })).rejects.toMatchObject({
            code: 'INVALID_QUERY',
        })
    })

    it('overlaps direct and History-managed plans after one ownership pass', async () => {
        let historyStarted = false
        let overlapped = false
        const controller = new AbortController()
        const handles = vi.fn((source: { id: string }) => source.id.endsWith('.managed'))
        const history: HistoryExtension = {
            attach: () => ({
                handles,
                async query(_source, _query, live, execution) {
                    expect(execution?.signal).toBe(controller.signal)
                    historyStarted = true
                    return live()
                },
            }),
        }
        const insight = createInsight({
            history,
            providers: [
                defineProvider({
                    adapters: {
                        direct: defineMetricAdapter({
                            async execute() {
                                await new Promise((resolve) => setTimeout(resolve, 20))
                                overlapped = historyStarted
                                return { values: { direct: 1 } }
                            },
                            metrics: { direct: {} },
                        }),
                        managed: defineMetricAdapter({
                            execute: () => ({ values: { managed: 2 } }),
                            metrics: { managed: {} },
                        }),
                    },
                    id: 'mixed',
                }),
            ],
        })

        const result = await insight.metrics(
            { metrics: ['direct', 'managed'], time },
            { signal: controller.signal },
        )

        expect(overlapped).toBe(true)
        expect(handles).toHaveBeenCalledTimes(2)
        expect(result.aggregate).toEqual({ direct: 1, managed: 2 })
    })

    it('selects logical Scopes without changing the query DSL', async () => {
        const provider = (value: number) =>
            defineProvider({
                adapters: {
                    traffic: defineMetricAdapter({
                        execute: () => ({ values: { requests: value } }),
                        metrics: { requests: {} },
                    }),
                },
                id: 'traffic',
            })
        const insight = createInsight({
            scopes: { production: [provider(10)], staging: [provider(1)] },
        })

        const production = await insight
            .scope('production')
            .metrics({ metrics: ['requests'], time })
        const staging = await insight.scope('staging').metrics({ metrics: ['requests'], time })

        expect(production.aggregate.requests).toBe(10)
        expect(staging.aggregate.requests).toBe(1)
        const invalidScope = () => {
            // @ts-expect-error Scope names are inferred from configuration
            insight.scope('provider')
        }
        void invalidScope
    })

    it('rejects duplicate Metric ownership and forwards abort signals', async () => {
        const adapter = (metric: 'requests') =>
            defineMetricAdapter({
                execute: (_query, context) => {
                    expect(context.signal).toBe(controller.signal)
                    return { values: { [metric]: 1 } }
                },
                metrics: { [metric]: {} },
            })
        expect(() =>
            createInsight({
                providers: [
                    defineProvider({ adapters: { first: adapter('requests') }, id: 'first' }),
                    defineProvider({ adapters: { second: adapter('requests') }, id: 'second' }),
                ],
            }),
        ).toThrow('more than one adapter')

        const controller = new AbortController()
        const insight = createInsight({
            providers: [defineProvider({ adapters: { first: adapter('requests') }, id: 'first' })],
        })
        await insight.metrics({ metrics: ['requests'], time }, { signal: controller.signal })
    })
})

describe('Metric adapter boundary', () => {
    const adapter = defineMetricAdapter({
        dimensions: {
            country: { operators: ['eq', 'in'], type: 'string' },
            latency: { operators: ['gt'], type: 'number' },
        },
        execute: () => ({ values: { requests: 1 } }),
        metrics: { requests: {} },
    })

    it('normalizes equivalent filters to one exact key', () => {
        const shorthand = adapter.normalize({
            metrics: ['requests'],
            time,
            where: { country: 'JP' },
        })
        const explicit = adapter.normalize({
            metrics: ['requests'],
            time,
            where: { country: { eq: 'JP' } },
        })
        expect(adapter.key(shorthand)).toBe(adapter.key(explicit))
    })

    it('materializes rows once and derives filter value types', async () => {
        const dimensions = { country: 'JP' }
        const rowAdapter = defineMetricAdapter({
            dimensions: { country: 'string' },
            execute: () => ({
                points: [
                    {
                        dimensions,
                        time: '2026-08-01T10:00:00Z',
                        values: { errors: 1, requests: 7 },
                    },
                ],
                values: { errors: 1, requests: 7 },
            }),
            metrics: { errors: {}, requests: {} },
        })
        const result = await rowAdapter.execute(
            rowAdapter.normalize({
                dimensions: ['country'],
                metrics: ['requests', 'errors'],
                time,
            }),
            { adapter: 'demo.metrics', provider: 'demo', scope: 'default' },
        )

        expect(result.data.rows?.[0]?.time).toBe('2026-08-01T10:00:00.000Z')
        expect(result.data.rows?.[0]?.dimensions).toBe(dimensions)
        const invalidQueries = () => {
            adapter.normalize({
                metrics: ['requests'],
                time,
                // @ts-expect-error country does not support numeric comparisons
                where: { country: { gt: 10 } },
            })
            adapter.normalize({
                metrics: ['requests'],
                time,
                // @ts-expect-error latency comparisons require numbers
                where: { latency: { gt: 'slow' } },
            })
        }
        void invalidQueries
    })
})

describe('events and instrumentation', () => {
    it('routes Track through the selected Scope without exposing query values', async () => {
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
                defineProvider({
                    adapters: {
                        traffic: defineMetricAdapter({
                            execute: () => ({ values: { requests: 1 } }),
                            metrics: { requests: {} },
                        }),
                    },
                    events: { track },
                    id: 'events',
                }),
            ],
        } as const
        type SearchProperties = EventProperties<typeof options, 'search'>
        expectTypeOf<SearchProperties>().toEqualTypeOf<{ readonly resultCount: number }>()
        const insight = createInsight(options)

        await insight.metrics({ metrics: ['requests'], time: { ...time, to: '2026-08-02' } })
        await insight.track('search', { resultCount: 4 })

        expect(track).toHaveBeenCalledWith(
            expect.objectContaining({
                context: { spanId: 'span', traceId: 'trace' },
                name: 'search',
            }),
        )
        expect(JSON.stringify(calls)).not.toContain('2026-08-02')
    })

    it('compiles event validation and Scope routing once', async () => {
        let schemaReads = 0
        let routeReads = 0
        const track = vi.fn<EventDestination['track']>()
        const properties: { readonly kind: readonly ['open', 'close'] } = {
            get kind() {
                schemaReads += 1
                return ['open', 'close'] as const
            },
        }
        const provider = defineProvider({
            get events() {
                routeReads += 1
                return { track }
            },
            id: 'events',
        })
        const insight = createInsight({
            events: { interaction: { properties } },
            providers: [provider],
        })

        await Promise.all(
            Array.from({ length: 100 }, () => insight.track('interaction', { kind: 'open' })),
        )

        expect(schemaReads).toBe(1)
        expect(routeReads).toBe(1)
        expect(track).toHaveBeenCalledTimes(100)
    })
})

expectTypeOf<QueryResult<{ value: number }>>().toMatchTypeOf<QueryResult<object>>()
