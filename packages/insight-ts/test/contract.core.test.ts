/* eslint-disable typescript/unbound-method, unicorn/consistent-function-scoping, vitest/require-mock-type-parameters */

import { describe, expect, expectTypeOf, it, vi } from 'vitest'

import {
    createInsight,
    defineProvider,
    type CapabilityAdapterDefinition,
    type CapabilityContract,
    type CapabilitySchema,
    type EventDestination,
    type EventProperties,
    type HistoryExtension,
    type Instrumentation,
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

    it('deduplicates exact concurrent direct queries', async () => {
        const execute = vi.fn(({ metrics }: { metrics: readonly string[] }) => ({
            values: Object.fromEntries(metrics.map((key) => [key, 1])),
        }))
        const adapter = defineMetricAdapter({
            execute,
            metrics: { requests: {} },
        })
        const insight = createInsight({
            providers: [defineProvider({ adapters: { traffic: adapter }, id: 'app' })],
        })

        const [first, second] = await Promise.all([
            insight.metrics({ metrics: ['requests'], time }),
            insight.metrics({ metrics: ['requests'], time }),
        ])

        expect(execute).toHaveBeenCalledOnce()
        expect(first.aggregate).toEqual(second.aggregate)
    })

    it('cancels queued work before the scheduler flushes', async () => {
        const execute = vi.fn(usageAdapter.execute)
        const insight = createInsight({
            providers: [
                defineProvider({ adapters: { usage: { ...usageAdapter, execute } }, id: 'app' }),
            ],
        })
        const controller = new AbortController()
        const reason = new Error('cancel queued query')

        const result = insight.usage({ account: 'acme' }, { signal: controller.signal })
        controller.abort(reason)

        await expect(result).rejects.toBe(reason)
        expect(execute).not.toHaveBeenCalled()

        const alreadyAborted = new AbortController()
        alreadyAborted.abort(reason)
        await expect(
            insight.usage({ account: 'already-aborted' }, { signal: alreadyAborted.signal }),
        ).rejects.toBe(reason)
        expect(execute).not.toHaveBeenCalled()
    })

    it('keeps shared in-flight work alive until its last caller aborts', async () => {
        const resolutions: ((value: { data: { spent: number } }) => void)[] = []
        const nativeSignals: AbortSignal[] = []
        const execute = vi.fn(
            (_query: { account: string }, { signal }: { signal?: AbortSignal }) =>
                new Promise<{ data: { spent: number } }>((resolve, reject) => {
                    nativeSignals.push(signal!)
                    resolutions.push(resolve)
                    signal?.addEventListener('abort', () => reject(signal.reason), { once: true })
                }),
        )
        const insight = createInsight({
            providers: [
                defineProvider({ adapters: { usage: { ...usageAdapter, execute } }, id: 'app' }),
            ],
        })
        const firstController = new AbortController()
        const secondController = new AbortController()
        const firstReason = new Error('cancel first caller')
        const first = insight.usage({ account: 'shared' }, { signal: firstController.signal })
        await vi.waitFor(() => expect(execute).toHaveBeenCalledOnce())
        const second = insight.usage({ account: 'shared' }, { signal: secondController.signal })

        firstController.abort(firstReason)

        await expect(first).rejects.toBe(firstReason)
        expect(nativeSignals[0]?.aborted).toBe(false)
        resolutions[0]!({ data: { spent: 6 } })
        await expect(second).resolves.toMatchObject({ spent: 6 })

        const thirdController = new AbortController()
        const fourthController = new AbortController()
        const thirdReason = new Error('cancel third caller')
        const fourthReason = new Error('cancel fourth caller')
        const third = insight.usage({ account: 'abandoned' }, { signal: thirdController.signal })
        const fourth = insight.usage({ account: 'abandoned' }, { signal: fourthController.signal })
        await vi.waitFor(() => expect(execute).toHaveBeenCalledTimes(2))

        thirdController.abort(thirdReason)
        fourthController.abort(fourthReason)

        await expect(third).rejects.toBe(thirdReason)
        await expect(fourth).rejects.toBe(fourthReason)
        expect(nativeSignals[1]?.aborted).toBe(true)
    })

    it('applies one concurrency limit across direct calls', async () => {
        let active = 0
        let maximum = 0
        let release!: () => void
        const gate = new Promise<void>((resolve) => {
            release = resolve
        })
        const execute = vi.fn(async ({ account }: { account: string }) => {
            active += 1
            maximum = Math.max(maximum, active)
            await gate
            active -= 1
            return { data: { spent: account.length } }
        })
        const insight = createInsight({
            providers: [
                defineProvider({ adapters: { usage: { ...usageAdapter, execute } }, id: 'app' }),
            ],
        })

        const results = Array.from({ length: 12 }, (_, index) =>
            insight.usage({ account: `account-${index}` }),
        )
        await vi.waitFor(() => expect(execute).toHaveBeenCalledTimes(8))

        expect(maximum).toBe(8)
        release()
        await Promise.all(results)
        expect(execute).toHaveBeenCalledTimes(12)
        expect(maximum).toBe(8)
    })

    it('keeps failures from different scheduled queries independent', async () => {
        const failure = new Error('account unavailable')
        const insight = createInsight({
            providers: [
                defineProvider({
                    adapters: {
                        usage: {
                            ...usageAdapter,
                            execute: ({ account }: { account: string }) => {
                                if (account === 'broken') throw failure
                                return { data: { spent: account.length } }
                            },
                        },
                    },
                    id: 'app',
                }),
            ],
        })

        const [broken, working] = await Promise.allSettled([
            insight.usage({ account: 'broken' }),
            insight.usage({ account: 'working' }),
        ])

        expect(broken).toEqual({ reason: failure, status: 'rejected' })
        expect(working).toMatchObject({ status: 'fulfilled', value: { spent: 7 } })
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

    it('rejects duplicate Metric ownership and supplies a native abort signal', async () => {
        const adapter = (metric: 'requests') =>
            defineMetricAdapter({
                execute: (_query, context) => {
                    expect(context.signal?.aborted).toBe(false)
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
