/* eslint-disable typescript/unbound-method, unicorn/consistent-function-scoping, vitest/require-mock-type-parameters */

import { describe, expect, expectTypeOf, it, vi } from 'vitest'

import {
    createInsight,
    defineProvider,
    type AdapterExecutionResult,
    type EventDestination,
    type EventProperties,
    type Instrumentation,
    type ProviderExecutionRequest,
    type QueryResult,
} from '../src/core/index.ts'
import { defineMetricAdapter, type MetricData, type TimeRange } from '../src/metrics/index.ts'

const time = {
    from: '2026-08-01T00:00:00.000Z',
    to: '2026-08-02T00:00:00.000Z',
} satisfies TimeRange

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

        const result = await insight.query((q) => ({
            overview: q.metrics({
                dimensions: ['country'],
                metrics: ['requests', 'errors'],
                time,
            }),
        }))

        expectTypeOf(result.overview.data).toEqualTypeOf<MetricData>()
        expect(requests).toHaveBeenCalledOnce()
        expect(errors).toHaveBeenCalledOnce()
        expect(result.overview).toEqual({
            data: {
                points: [
                    {
                        dimensions: { country: 'JP' },
                        time: '2026-08-01T01:00:00.000Z',
                        values: { errors: 1, requests: 7 },
                    },
                ],
                values: { errors: 1, requests: 7 },
            },
            meta: {
                contributions: [
                    {
                        fields: ['requests'],
                        quality: { sampled: true, sampleRate: 0.5 },
                    },
                    { fields: ['errors'] },
                ],
                quality: { sampled: true, sampleRate: 0.5 },
                queriedAt: '2026-08-02T00:00:00.000Z',
            },
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
            insight.query((q) => ({
                invalid: q.metrics({
                    dimensions: ['country'],
                    metrics: ['requests', 'errors'],
                    time,
                }),
            })),
        ).rejects.toMatchObject({ code: 'UNSUPPORTED_DIMENSION' })
        expect(execute).not.toHaveBeenCalled()
    })

    it('deduplicates exact plans and batches compatible Provider requests', async () => {
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

        const result = await insight.query((q) => ({
            first: q.metrics({ metrics: ['requests'], time }),
            second: q.metrics({ metrics: ['requests'], time }),
        }))

        expect(execute).toHaveBeenCalledOnce()
        expect(execute.mock.calls[0]?.[0]).toHaveLength(1)
        expect(result.first).toEqual(result.second)
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

        const production = await insight.scope('production').query((q) => ({
            requests: q.metrics({ metrics: ['requests'], time }),
        }))
        const staging = await insight.scope('staging').query((q) => ({
            requests: q.metrics({ metrics: ['requests'], time }),
        }))

        expect(production.requests.data.values.requests).toBe(10)
        expect(staging.requests.data.values.requests).toBe(1)
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
        await insight.query((q) => ({ requests: q.metrics({ metrics: ['requests'], time }) }), {
            signal: controller.signal,
        })
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

        expect(result.data.points?.[0]?.time).toBe('2026-08-01T10:00:00.000Z')
        expect(result.data.points?.[0]?.dimensions).toBe(dimensions)
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

        await insight.query((q) => ({
            secret: q.metrics({ metrics: ['requests'], time: { ...time, to: '2026-08-02' } }),
        }))
        await insight.track('search', { resultCount: 4 })

        expect(track).toHaveBeenCalledWith(
            expect.objectContaining({
                context: { spanId: 'span', traceId: 'trace' },
                name: 'search',
            }),
        )
        expect(JSON.stringify(calls)).not.toContain('2026-08-02')
    })
})

expectTypeOf<QueryResult<{ value: number }>>().toMatchTypeOf<QueryResult<unknown>>()
