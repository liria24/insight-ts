import { describe, expect, it, vi } from 'vitest'

import {
    createInsight,
    defineProvider,
    type ProviderExecutionRequest,
    type AdapterExecutionResult,
} from '../src/core/index.ts'
import { createHistory, type HistoryRepository, type HistorySegment } from '../src/history/index.ts'
import { defineMetricAdapter, type TimeRange } from '../src/metrics/index.ts'

const range: TimeRange = {
    from: '2026-08-01T00:00:00.000Z',
    to: '2026-08-03T00:00:00.000Z',
}

const metricSource = defineMetricAdapter({
    dimensions: { service: { operators: ['eq'], type: 'string' } },
    execute: async (query) => ({
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

class MemoryRepository implements HistoryRepository {
    readonly segments: HistorySegment[] = []

    async coverage({ range: selected, source }: { range: TimeRange; source: string }) {
        return this.segments.filter(
            (segment) =>
                segment.source === source &&
                segment.range.from < selected.to &&
                segment.range.to > selected.from,
        )
    }

    async read(query: { range: TimeRange; source: string }) {
        return this.coverage(query)
    }

    async write(segment: HistorySegment) {
        const index = this.segments.findIndex(({ id }) => id === segment.id)
        if (index === -1) this.segments.push(segment)
        else this.segments[index] = segment
    }
}

describe('Metric History strategy', () => {
    it('syncs through normal Provider execution and serves covered queries', async () => {
        const repository = new MemoryRepository()
        const execute = vi.fn<
            (
                requests: readonly ProviderExecutionRequest[],
            ) => Promise<readonly AdapterExecutionResult<unknown, object>[]>
        >(
            async (
                requests: readonly ProviderExecutionRequest[],
            ): Promise<readonly AdapterExecutionResult<unknown, object>[]> =>
                Promise.all(requests.map((request) => request.execute())),
        )
        const provider = defineProvider({
            execute,
            id: 'otel',
            adapters: { metrics: metricSource },
        })
        const insight = createInsight({
            history: createHistory({ repository, sources: ['otel.metrics'] }),
            now: () => new Date('2026-08-29T00:00:00.000Z'),
            providers: [provider],
        })

        await expect(insight.history.sync({ range })).resolves.toEqual({ fetched: 1, skipped: 0 })
        expect(execute).toHaveBeenCalledOnce()
        expect(repository.segments).toHaveLength(1)
        const dashboard = await insight.query((q) => ({
            requests: q.metrics({
                dimensions: ['service'],
                metrics: ['requests'],
                time: { ...range, grain: 'day' },
            }),
        }))

        expect(execute).toHaveBeenCalledOnce()
        expect(dashboard.requests.data.values.requests).toBe(5)
        expect(dashboard.requests.meta.fidelity).toEqual([
            expect.objectContaining({ preservation: 'full', range }),
        ])
        await expect(insight.history.sync({ range })).resolves.toEqual({ fetched: 0, skipped: 1 })
    })

    it('rejects unsafe percentile rollup', async () => {
        const repository = new MemoryRepository()
        const insight = createInsight({
            history: createHistory({ repository, sources: ['otel.metrics'] }),
            providers: [defineProvider({ adapters: { metrics: metricSource }, id: 'otel' })],
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
    })

    it('falls back to live execution for filters not represented by History', async () => {
        const execute = vi.fn<typeof metricSource.execute>((query, context) =>
            metricSource.execute(query, context),
        )
        const source = { ...metricSource, execute }
        const insight = createInsight({
            history: createHistory({
                repository: new MemoryRepository(),
                sources: ['otel.metrics'],
            }),
            providers: [defineProvider({ adapters: { metrics: source }, id: 'otel' })],
        })

        await insight.query((q) => ({
            filtered: q.metrics({
                metrics: ['requests'],
                time: range,
                where: { service: 'api' },
            }),
        }))
        expect(execute).toHaveBeenCalledOnce()
    })
})
