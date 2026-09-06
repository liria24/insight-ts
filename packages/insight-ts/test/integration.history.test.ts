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
    readonly coverageReads: (HistoryTarget & { range: TimeRange })[] = []
    readonly reads: HistoryReadQuery[] = []
    readonly replacements: { range: TimeRange; size: number }[] = []
    readonly segments: HistorySegment[] = []

    async coverage(query: HistoryTarget & { range: TimeRange }) {
        this.coverageReads.push(query)
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
        const coverageReads = repository.coverageReads.length
        const [logResult, metricResult, traceResult] = await Promise.all([
            insight.logs({ time: range }),
            insight.metrics({ metrics: ['requests'], time: { ...range, grain: 'day' } }),
            insight.traces({ time: range }),
        ])

        expect(logResult.logs.map(({ id }) => id)).toEqual(['log-2', 'log-1'])
        expect(metricResult.aggregate.requests).toBe(5)
        expect(traceResult.traces[0]?.traceId).toBe('trace-1')
        expect({
            logs: logs.mock.calls.length,
            metrics: metrics.mock.calls.length,
            traces: traces.mock.calls.length,
        }).toEqual(calls)
        expect(repository.coverageReads).toHaveLength(coverageReads + 3)
        await expect(insight.history.sync({ range })).resolves.toEqual({ fetched: 0, skipped: 3 })
    })

    it('keeps event reads bounded across result continuation', async () => {
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

        const first = await insight.logs({ limit: 2, time: range })
        const second = await insight.next(first)

        expect(first.logs.map(({ id }) => id)).toEqual(['log-3', 'log-2'])
        expect(second.logs.map(({ id }) => id)).toEqual(['log-1'])
        expect(second.meta.pagination).toBeUndefined()
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
        const result = await insight.logs({ limit: 1, time: range })
        expect(result.logs[0]?.id).toBe('log-0')
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

    it('replaces idempotently and expires explicit ranges', async () => {
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
        await expect(
            insight.history.expire({ before: '2026-08-04T00:00:00.000Z' }),
        ).resolves.toEqual({ deleted: 1 })
        expect(repository.segments).toEqual([])
    })

    it('fetches only uncovered half-open range boundaries', async () => {
        const repository = new MemoryRepository()
        const execute = vi.fn((query: { time: TimeRange }) => ({
            points: [{ time: query.time.from, values: { requests: 1 } }],
            values: { requests: 1 },
        }))
        const insight = createInsight({
            history: createHistory({ capabilities: ['metrics'], repository }),
            providers: [
                defineProvider({
                    adapters: {
                        metrics: defineMetricAdapter({
                            execute,
                            history: { grain: 'day', metrics: ['requests'] },
                            metrics: {
                                requests: { aggregation: { kind: 'sum' }, rollup: 'additive' },
                            },
                        }),
                    },
                    id: 'app',
                }),
            ],
        })
        const firstDay = { from: range.from, to: '2026-08-02T00:00:00.000Z' }
        await insight.history.sync({ range: firstDay })
        execute.mockClear()

        const result = await insight.metrics({
            metrics: ['requests'],
            time: { ...range, grain: 'day' },
        })

        expect(execute).toHaveBeenCalledOnce()
        expect(execute).toHaveBeenCalledWith(
            expect.objectContaining({ time: { from: firstDay.to, to: range.to } }),
            expect.any(Object),
        )
        expect(result.aggregate.requests).toBe(2)
    })

    it('does not recapture stable partial results after a failed attempt', async () => {
        const repository = new MemoryRepository()
        let attempt = 0
        const execute = vi.fn(() => {
            attempt += 1
            if (attempt === 1) throw new Error('temporary failure')
            return {
                logs: [{ id: `log-${attempt}`, timestamp: range.from }],
                quality: { partial: true },
            }
        })
        const insight = createInsight({
            history: createHistory({ capabilities: ['logs'], repository }),
            providers: [
                defineProvider({
                    adapters: { logs: defineLogAdapter({ execute }) },
                    id: 'app',
                }),
            ],
        })

        await expect(insight.history.sync({ range })).rejects.toThrow('temporary failure')
        expect(repository.segments).toEqual([])
        await expect(insight.history.sync({ range })).resolves.toEqual({ fetched: 1, skipped: 0 })
        expect(repository.segments.every(({ provisional }) => !provisional)).toBe(true)
        await expect(insight.history.sync({ range })).resolves.toEqual({ fetched: 0, skipped: 1 })
        expect(execute).toHaveBeenCalledTimes(2)
    })

    it('preserves a stable prefix while refreshing only its provisional suffix', async () => {
        const repository = new MemoryRepository()
        const boundary = '2026-08-02T00:00:00.000Z'
        let provisional = true
        const execute = vi.fn((query: { time: TimeRange }) => ({
            meta: {
                ...(provisional && query.time.to > boundary
                    ? { freshness: { provisionalFrom: boundary } }
                    : {}),
                temporal: { bucketTimezone: 'UTC', grain: 'day' as const },
            },
            points: [{ time: query.time.from, values: { requests: 1 } }],
            quality: { partial: true },
            values: { requests: 1 },
        }))
        const insight = createInsight({
            history: createHistory({ capabilities: ['metrics'], repository }),
            providers: [
                defineProvider({
                    adapters: {
                        metrics: defineMetricAdapter({
                            execute,
                            history: { grain: 'day', metrics: ['requests'] },
                            metrics: {
                                requests: { aggregation: { kind: 'sum' }, rollup: 'additive' },
                            },
                        }),
                    },
                    id: 'app',
                }),
            ],
        })

        await insight.history.sync({ range })
        expect(
            repository.segments.map(({ provisional: value, range: stored }) => ({
                provisional: Boolean(value),
                range: stored,
            })),
        ).toEqual([
            { provisional: false, range: { from: range.from, to: boundary } },
            { provisional: true, range: { from: boundary, to: range.to } },
        ])

        provisional = false
        execute.mockClear()
        await insight.history.sync({ range })
        expect(execute).toHaveBeenCalledOnce()
        expect(execute).toHaveBeenCalledWith(
            expect.objectContaining({ time: { from: boundary, to: range.to } }),
            expect.any(Object),
        )
        expect(repository.segments.every((segment) => !segment.provisional)).toBe(true)
        expect(repository.segments.every((segment) => segment.quality?.partial)).toBe(true)
    })

    it('rejects repository cursor loops and corrupt segments', async () => {
        const base = new MemoryRepository()
        const looping: HistoryRepository = {
            coverage: async () => [{ id: 'covered', range }],
            delete: (query) => base.delete(query),
            read: async () => ({ next: 'loop', segments: [] }),
            replace: (query, segments) => base.replace(query, segments),
        }
        const provider = defineProvider({
            adapters: {
                metrics: defineMetricAdapter({
                    execute: () => ({ values: { requests: 1 } }),
                    metrics: { requests: { rollup: 'additive' } },
                }),
            },
            id: 'app',
        })
        const loop = createInsight({
            history: createHistory({ capabilities: ['metrics'], repository: looping }),
            providers: [provider],
        })
        await expect(loop.metrics({ metrics: ['requests'], time: range })).rejects.toMatchObject({
            code: 'HISTORY_CORRUPT',
        })

        const corrupt: HistoryRepository = {
            ...looping,
            read: async () => ({
                segments: [
                    {
                        adapter: 'wrong.metrics',
                        capability: 'metrics',
                        data: { aggregate: { requests: 1 } },
                        id: 'corrupt',
                        observedAt: range.to,
                        range,
                        schemaVersion: 3,
                        scope: 'default',
                        sortKey: 'metrics',
                    },
                ],
            }),
        }
        const corrupted = createInsight({
            history: createHistory({ capabilities: ['metrics'], repository: corrupt }),
            providers: [provider],
        })
        await expect(
            corrupted.metrics({ metrics: ['requests'], time: range }),
        ).rejects.toMatchObject({ code: 'HISTORY_CORRUPT' })
    })

    it('uses History only when every requested Metric projection is safe', async () => {
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
        const calls = execute.mock.calls.length
        const storedRows = await insight.metrics({
            dimensions: ['service'],
            metrics: ['latencyP95'],
            projection: 'rows',
            time: { ...range, grain: 'day' },
        })
        expect(storedRows.rows).toHaveLength(2)
        expect(execute).toHaveBeenCalledTimes(calls)

        const live = await insight.metrics({
            metrics: ['latencyP95'],
            time: { ...range, grain: 'week' },
        })
        expect(live.aggregate.latencyP95).toBe(200)
        expect(execute).toHaveBeenCalledTimes(calls + 1)

        await insight.metrics({
            metrics: ['requests'],
            time: range,
            where: { service: 'api' },
        })
        expect(execute).toHaveBeenCalledTimes(calls + 2)
    })

    it('matches stored Metric grain and bucket timezone before using History', async () => {
        const repository = new MemoryRepository()
        const pacificRange = {
            from: '2026-08-03T07:00:00.000Z',
            to: '2026-08-05T07:00:00.000Z',
        }
        const execute = vi.fn((query: { time: TimeRange }) => ({
            meta: {
                temporal: {
                    bucketTimezone: 'America/Los_Angeles',
                    grain: 'day' as const,
                    sourceTimezone: 'America/Los_Angeles',
                },
            },
            points: [{ time: query.time.from, values: { requests: 2 } }],
            values: { requests: 2 },
        }))
        const insight = createInsight({
            history: createHistory({ capabilities: ['metrics'], repository }),
            providers: [
                defineProvider({
                    adapters: {
                        metrics: defineMetricAdapter({
                            execute,
                            history: {
                                grain: 'day',
                                metrics: ['requests'],
                                timezone: 'America/Los_Angeles',
                            },
                            metrics: {
                                requests: { aggregation: { kind: 'sum' }, rollup: 'additive' },
                            },
                        }),
                    },
                    id: 'app',
                }),
            ],
        })
        await insight.history.sync({ range: pacificRange })
        const calls = execute.mock.calls.length
        const coverageReads = repository.coverageReads.length

        const stored = await insight.metrics({
            metrics: ['requests'],
            projection: 'rows',
            time: { ...pacificRange, grain: 'day' },
            timezone: 'America/Los_Angeles',
        })
        expect(stored.rows[0]?.time).toBe(pacificRange.from)
        expect(execute).toHaveBeenCalledTimes(calls)

        await insight.metrics({
            metrics: ['requests'],
            time: pacificRange,
            timezone: 'UTC',
        })
        await insight.metrics({
            metrics: ['requests'],
            projection: 'rows',
            time: { ...pacificRange, grain: 'hour' },
            timezone: 'America/Los_Angeles',
        })
        expect(execute).toHaveBeenCalledTimes(calls + 2)
        expect(repository.coverageReads).toHaveLength(coverageReads + 1)
    })
})

const sameTarget = (left: HistoryTarget, right: HistoryTarget): boolean =>
    left.adapter === right.adapter &&
    left.capability === right.capability &&
    left.scope === right.scope

const overlaps = (left: TimeRange, right: TimeRange): boolean =>
    left.from < right.to && right.from < left.to
