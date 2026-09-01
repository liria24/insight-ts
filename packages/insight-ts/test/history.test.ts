/* eslint-disable vitest/require-mock-type-parameters */

import { describe, expect, it, vi } from 'vitest'

import { createInsight, defineProvider, type Instrumentation } from '../src/core/index.ts'
import {
    createHistory,
    type HistoryReadQuery,
    type HistoryRepository,
    type HistorySegment,
    type HistoryTarget,
} from '../src/history/index.ts'
import { defineLogAdapter, type NormalizedLogQuery } from '../src/logs/index.ts'
import { defineMetricAdapter, type TimeRange } from '../src/metrics/index.ts'
import { cloudflare } from '../src/providers/cloudflare/index.ts'
import { defineTraceAdapter } from '../src/traces/index.ts'

const range: TimeRange = {
    from: '2026-08-01T00:00:00.000Z',
    to: '2026-08-03T00:00:00.000Z',
}

class MemoryRepository implements HistoryRepository {
    readonly reads: HistoryReadQuery[] = []
    readonly replacements: { range: TimeRange; size: number }[] = []
    readonly segments: HistorySegment[] = []

    async coverage(query: HistoryTarget & { range: TimeRange }) {
        return this.#matching(query)
    }

    async delete(query: HistoryTarget & { range: TimeRange }) {
        this.#remove(query)
    }

    async read(query: HistoryReadQuery) {
        this.reads.push(query)
        const segments = this.#matching(query).toSorted(
            (left, right) =>
                right.sortKey.localeCompare(left.sortKey) || left.id.localeCompare(right.id),
        )
        const offset = Number(query.cursor ?? 0)
        const page = segments.slice(offset, offset + query.limit)
        return {
            ...(offset + page.length < segments.length
                ? { next: String(offset + page.length) }
                : {}),
            segments: page,
        }
    }

    async replace(
        query: HistoryTarget & { range: TimeRange },
        segments: readonly HistorySegment[],
    ) {
        this.replacements.push({ range: query.range, size: segments.length })
        this.#remove(query)
        this.segments.push(...segments)
    }

    #matching(query: HistoryTarget & { range: TimeRange }) {
        return this.segments.filter(
            (segment) => sameTarget(segment, query) && overlaps(segment.range, query.range),
        )
    }

    #remove(query: HistoryTarget & { range: TimeRange }) {
        const retained = this.segments.filter(
            (segment) => !sameTarget(segment, query) || !overlaps(segment.range, query.range),
        )
        this.segments.splice(0, this.segments.length, ...retained)
    }
}

const metricAdapter = defineMetricAdapter({
    dimensions: { service: { operators: ['eq'], type: 'string' } },
    execute: (query) => ({
        points: [
            {
                dimensions: { service: 'api' },
                time: query.time.from,
                values: { latencyP95: 100, requests: 2 },
            },
            {
                dimensions: { service: 'api' },
                time: '2026-08-02T00:00:00.000Z',
                values: { latencyP95: 200, requests: 3 },
            },
        ],
        values: { latencyP95: 200, requests: 5 },
    }),
    history: {
        dimensions: ['service'],
        grain: 'day',
        metrics: ['requests', 'latencyP95'],
    },
    metrics: {
        latencyP95: {
            aggregation: { kind: 'percentile', quantile: 0.95 },
            rollup: 'non-additive',
            unit: 'ms',
        },
        requests: { aggregation: { kind: 'sum' }, rollup: 'additive', unit: '{request}' },
    },
})

describe('generic History', () => {
    it('syncs Metrics, Logs, and Traces through one capability workflow', async () => {
        const repository = new MemoryRepository()
        const logs = vi.fn(({ nativeCursor }: { nativeCursor?: string }) =>
            nativeCursor
                ? {
                      logs: [
                          {
                              body: 'older',
                              id: 'log-1',
                              timestamp: '2026-08-01T01:00:00.000Z',
                          },
                      ],
                  }
                : {
                      logs: [
                          {
                              body: 'newer',
                              id: 'log-2',
                              timestamp: '2026-08-02T01:00:00.000Z',
                          },
                      ],
                      nativeCursor: 'page-2',
                  },
        )
        const traces = vi.fn(() => ({
            traces: [{ startTime: '2026-08-02T02:00:00.000Z', traceId: 'trace-1' }],
        }))
        const metrics = vi.fn<typeof metricAdapter.execute>((query, context) =>
            metricAdapter.execute(query, context),
        )
        const insight = createInsight({
            history: createHistory({ repository }),
            providers: [
                defineProvider({
                    adapters: {
                        logs: defineLogAdapter({ execute: logs }),
                        metrics: { ...metricAdapter, execute: metrics },
                        traces: defineTraceAdapter({ execute: traces }),
                    },
                    id: 'otel',
                }),
            ],
        })

        await expect(insight.history.sync({ range })).resolves.toEqual({ fetched: 3, skipped: 0 })
        expect(logs).toHaveBeenCalledTimes(2)
        const calls = {
            logs: logs.mock.calls.length,
            metrics: metrics.mock.calls.length,
            traces: traces.mock.calls.length,
        }
        const result = await insight.query((q) => ({
            logs: q.logs({ time: range }),
            metrics: q.metrics({ metrics: ['requests'], time: { ...range, grain: 'day' } }),
            traces: q.traces({ time: range }),
        }))

        expect(result.logs.data.logs.map(({ id }) => id)).toEqual(['log-2', 'log-1'])
        expect(result.metrics.data.values.requests).toBe(5)
        expect(result.traces.data.traces[0]?.traceId).toBe('trace-1')
        expect({
            logs: logs.mock.calls.length,
            metrics: metrics.mock.calls.length,
            traces: traces.mock.calls.length,
        }).toEqual(calls)
        expect(result.logs.meta.fidelity).toEqual([
            expect.objectContaining({ preservation: 'full', range }),
        ])
        await expect(insight.history.sync({ range })).resolves.toEqual({ fetched: 0, skipped: 3 })
    })

    it('keeps event reads bounded and continues with opaque query cursors', async () => {
        const repository = new MemoryRepository()
        const execute = vi.fn(() => ({
            logs: [1, 2, 3].map((value) => ({
                id: `log-${value}`,
                timestamp: `2026-08-02T0${value}:00:00.000Z`,
            })),
        }))
        const insight = createInsight({
            history: createHistory({ capabilities: ['logs'], repository }),
            providers: [
                defineProvider({
                    adapters: { logs: defineLogAdapter({ execute }) },
                    id: 'otel',
                }),
            ],
        })
        await insight.history.sync({ range })
        const providerCalls = execute.mock.calls.length

        const first = await insight.query((q) => ({ logs: q.logs({ limit: 2, time: range }) }))
        const second = await insight.query((q) => ({
            logs: q.logs({ cursor: first.logs.meta.pagination!.next!, limit: 2, time: range }),
        }))

        expect(first.logs.data.logs.map(({ id }) => id)).toEqual(['log-3', 'log-2'])
        expect(second.logs.data.logs.map(({ id }) => id)).toEqual(['log-1'])
        expect(second.logs.meta.pagination).toBeUndefined()
        expect(repository.reads.map(({ limit }) => limit)).toEqual([2, 2])
        expect(execute).toHaveBeenCalledTimes(providerCalls)
    })

    it('drains Cloudflare native continuation before marking Log coverage complete', async () => {
        let page = 0
        const fetcher = vi.fn<(input: RequestInfo | URL, init?: RequestInit) => Promise<Response>>(
            async () => {
                const events =
                    page++ === 0
                        ? Array.from({ length: 1000 }, (_, index) => ({
                              $metadata: { id: `log-${index}` },
                              source: `log ${index}`,
                              timestamp: Date.parse(range.to) - index - 1,
                          }))
                        : [
                              {
                                  $metadata: { id: 'log-1000' },
                                  source: 'oldest',
                                  timestamp: Date.parse(range.from),
                              },
                          ]
                return Response.json({
                    result: { events: { events }, run: { status: 'COMPLETED' } },
                })
            },
        )
        const repository = new MemoryRepository()
        const insight = createInsight({
            history: createHistory({ capabilities: ['logs'], repository }),
            providers: [
                cloudflare({
                    accountId: 'account',
                    apiToken: 'token',
                    workersObservability: { fetch: fetcher },
                }),
            ],
        })

        await insight.history.sync({ range })
        expect(fetcher).toHaveBeenCalledTimes(2)
        expect(repository.segments).toHaveLength(1001)
        const calls = fetcher.mock.calls.length
        const result = await insight.query((q) => ({ logs: q.logs({ limit: 1, time: range }) }))
        expect(result.logs.data.logs[0]?.id).toBe('log-0')
        expect(fetcher).toHaveBeenCalledTimes(calls)
    })

    it('persists multi-page event capture in bounded time partitions', async () => {
        const repository = new MemoryRepository()
        const spans: { attributes: Record<string, boolean | number | string>; name: string }[] = []
        const instrumentation: Instrumentation = {
            async run(name, attributes, operation) {
                const recorded = { attributes: { ...attributes }, name }
                spans.push(recorded)
                return operation({
                    recordException: () => undefined,
                    setAttribute: (key, value) => {
                        recorded.attributes[key] = value
                    },
                })
            },
        }
        const execute = vi.fn((query: NormalizedLogQuery) => ({
            logs: [
                {
                    id: `${query.time.from}-${query.nativeCursor ?? 'first'}`,
                    timestamp: query.time.from,
                },
            ],
            ...(query.nativeCursor ? {} : { nativeCursor: 'next' }),
        }))
        const insight = createInsight({
            history: createHistory({ capabilities: ['logs'], repository }),
            instrumentation,
            providers: [
                defineProvider({
                    adapters: { logs: defineLogAdapter({ execute }) },
                    id: 'otel',
                }),
            ],
        })
        const threeWeeks = {
            from: '2026-08-06T00:00:00.000Z',
            to: '2026-08-27T00:00:00.000Z',
        }

        await expect(insight.history.sync({ range: threeWeeks })).resolves.toEqual({
            fetched: 3,
            skipped: 0,
        })
        expect(execute).toHaveBeenCalledTimes(6)
        expect(repository.replacements).toEqual([
            { range: { from: threeWeeks.from, to: '2026-08-13T00:00:00.000Z' }, size: 2 },
            {
                range: {
                    from: '2026-08-13T00:00:00.000Z',
                    to: '2026-08-20T00:00:00.000Z',
                },
                size: 2,
            },
            { range: { from: '2026-08-20T00:00:00.000Z', to: threeWeeks.to }, size: 2 },
        ])
        expect(
            spans
                .filter(({ name }) => name === 'insight.history.capture')
                .map(({ attributes }) => attributes),
        ).toEqual(
            Array.from({ length: 3 }, () =>
                expect.objectContaining({
                    'insight.history.item.count': 2,
                    'insight.history.item.peak': 2,
                    'insight.history.page.count': 2,
                }),
            ),
        )
        expect(spans.find(({ name }) => name === 'insight.history.sync')?.attributes).toMatchObject(
            { 'insight.history.partition.count': 3 },
        )
        await expect(insight.history.sync({ range: threeWeeks })).resolves.toEqual({
            fetched: 0,
            skipped: 1,
        })
        expect(repository.replacements).toHaveLength(3)
    })

    it('distinguishes reduced, empty, and not-preserved ranges', async () => {
        const reduced = createInsight({
            history: createHistory({
                capabilities: ['logs'],
                policies: [
                    {
                        capability: 'logs',
                        transformations: [{ kind: 'truncate', limit: 0 }],
                    },
                ],
                repository: new MemoryRepository(),
            }),
            providers: [
                defineProvider({
                    adapters: {
                        logs: defineLogAdapter({
                            execute: () => ({ logs: [{ id: 'removed', timestamp: range.from }] }),
                        }),
                    },
                    id: 'otel',
                }),
            ],
        })
        await reduced.history.sync({ range })
        const empty = await reduced.query((q) => ({ logs: q.logs({ time: range }) }))
        expect(empty.logs.data.logs).toEqual([])
        expect(empty.logs.meta.fidelity).toEqual([
            expect.objectContaining({ preservation: 'reduced', range }),
        ])

        const partial = createInsight({
            history: createHistory({ capabilities: ['logs'], repository: new MemoryRepository() }),
            providers: [
                defineProvider({
                    adapters: {
                        logs: defineLogAdapter({
                            execute: () => ({ logs: [], quality: { partial: true } }),
                        }),
                    },
                    id: 'otel',
                }),
            ],
        })
        const missing = await partial.query((q) => ({ logs: q.logs({ time: range }) }))
        expect(missing.logs.meta.quality).toEqual({ partial: true })
        expect(missing.logs.meta.fidelity).toContainEqual({
            preservation: 'not-preserved',
            range,
            transformations: [],
        })
    })

    it('replaces idempotently and exposes compact and retention lifecycle operations', async () => {
        const repository = new MemoryRepository()
        const insight = createInsight({
            history: createHistory({ capabilities: ['logs'], repository }),
            now: () => new Date('2026-09-01T00:00:00.000Z'),
            providers: [
                defineProvider({
                    adapters: {
                        logs: defineLogAdapter({
                            execute: () => ({ logs: [{ id: 'stable', timestamp: range.from }] }),
                        }),
                    },
                    id: 'otel',
                }),
            ],
        })
        await insight.history.sync({ range })
        const ids = repository.segments.map(({ id }) => id)
        await insight.history.sync({ range })
        expect(repository.segments.map(({ id }) => id)).toEqual(ids)
        await expect(insight.history.compact({ range })).resolves.toEqual({ compacted: 1 })
        expect(repository.segments.map(({ id }) => id)).toEqual(ids)
        await expect(
            insight.history.expire({ before: '2026-08-04T00:00:00.000Z' }),
        ).resolves.toEqual({ deleted: 1 })
        expect(repository.segments).toEqual([])
    })

    it('preserves safe Metric rollup rules and bypasses unrepresented filters', async () => {
        const execute = vi.fn<typeof metricAdapter.execute>((query, context) =>
            metricAdapter.execute(query, context),
        )
        const insight = createInsight({
            history: createHistory({
                capabilities: ['metrics'],
                repository: new MemoryRepository(),
            }),
            providers: [
                defineProvider({
                    adapters: { metrics: { ...metricAdapter, execute } },
                    id: 'otel',
                }),
            ],
        })
        await insight.history.sync({ range })
        await expect(
            insight.query((q) => ({
                latency: q.metrics({
                    metrics: ['latencyP95'],
                    time: { ...range, grain: 'week' },
                }),
            })),
        ).rejects.toMatchObject({ code: 'UNSAFE_ROLLUP' })
        const calls = execute.mock.calls.length
        await insight.query((q) => ({
            filtered: q.metrics({
                metrics: ['requests'],
                time: range,
                where: { service: 'api' },
            }),
        }))
        expect(execute).toHaveBeenCalledTimes(calls + 1)
    })
})

const sameTarget = (left: HistoryTarget, right: HistoryTarget): boolean =>
    left.adapter === right.adapter &&
    left.capability === right.capability &&
    left.scope === right.scope

const overlaps = (left: TimeRange, right: TimeRange): boolean =>
    left.from < right.to && right.from < left.to
