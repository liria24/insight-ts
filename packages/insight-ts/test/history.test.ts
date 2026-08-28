import { describe, expect, it, vi } from 'vitest'

import {
    createInsight,
    type ReportSourceDefinition,
    type SeriesQuery,
    type TimeRange,
} from '../src/core/index.ts'
import { defineProvider } from '../src/core/provider.ts'
import {
    createHistory,
    type HistoryCoverage,
    type HistoryRepository,
    type HistorySegment,
} from '../src/history/index.ts'

const day = 86_400_000
const range = {
    from: '2026-01-01T00:00:00.000Z',
    to: '2026-01-05T00:00:00.000Z',
} as const

class MemoryRepository implements HistoryRepository {
    readonly segments = new Map<string, HistorySegment>()

    async coverage(query: { range: TimeRange; source: string }): Promise<HistoryCoverage[]> {
        return (await this.read(query)).map(({ id, provisional, range: covered }) => ({
            id,
            ...(provisional ? { provisional } : {}),
            range: covered,
        }))
    }

    async read({ range: selected, source }: { range: TimeRange; source: string }) {
        return [...this.segments.values()].filter(
            (segment) =>
                segment.source === source &&
                segment.range.from < selected.to &&
                segment.range.to > selected.from,
        )
    }

    async write(segment: HistorySegment): Promise<void> {
        this.segments.set(segment.id, structuredClone(segment))
    }
}

function reportProvider(state: { provisional?: boolean } = {}) {
    const series = vi.fn<NonNullable<ReportSourceDefinition['series']>>(
        async (query: SeriesQuery) => {
            const from = new Date(query.range.from).valueOf()
            const count = (new Date(query.range.to).valueOf() - from) / day
            return {
                ...(state.provisional
                    ? {
                          freshness: { incompleteFrom: query.range.from },
                          quality: { partial: true, sampled: true },
                      }
                    : { quality: { sampled: true } }),
                points: Array.from({ length: count }, (_, index) => ({
                    time: new Date(from + index * day).toISOString(),
                    values: {
                        clicks: 2,
                        ctr: 0.5,
                        impressions: 4,
                        peak: 10 + index,
                        views: 3,
                    },
                })),
            }
        },
    )
    return {
        provider: defineProvider({
            id: 'app',
            reports: {
                usage: {
                    history: { grain: 'day', mode: 'range' },
                    metrics: {
                        clicks: { aggregation: 'sum', rollup: 'additive', valueType: 'integer' },
                        ctr: {
                            aggregation: 'ratio',
                            derive: {
                                denominator: 'impressions',
                                numerator: 'clicks',
                                operation: 'ratio',
                            },
                            rollup: 'derived',
                            valueType: 'ratio',
                        },
                        impressions: {
                            aggregation: 'sum',
                            rollup: 'additive',
                            valueType: 'integer',
                        },
                        peak: {
                            aggregation: 'max',
                            rollup: 'non-additive',
                            valueType: 'integer',
                        },
                        views: { aggregation: 'sum', rollup: 'additive', valueType: 'integer' },
                    },
                    series,
                },
            },
        }),
        series,
    }
}

function withHistory(repository: HistoryRepository, state: { provisional?: boolean } = {}) {
    const { provider, series } = reportProvider(state)
    const insight = createInsight({
        history: createHistory({ repository, sources: ['app.usage'] }),
        now: () => new Date('2026-01-10T00:00:00.000Z'),
        providers: [provider] as const,
    })
    return { insight, series }
}

describe('range History', () => {
    it('fetches only uncovered gaps and is idempotent', async () => {
        const repository = new MemoryRepository()
        const { insight, series } = withHistory(repository)

        await insight.history.sync({
            range: { from: range.from, to: '2026-01-03T00:00:00.000Z' },
        })
        series.mockClear()

        await expect(insight.history.sync({ range })).resolves.toEqual({ fetched: 1, skipped: 0 })
        expect(series).toHaveBeenCalledOnce()
        expect(series).toHaveBeenCalledWith(
            expect.objectContaining({
                range: {
                    from: '2026-01-03T00:00:00.000Z',
                    to: range.to,
                },
            }),
        )

        series.mockClear()
        await expect(insight.history.sync({ range })).resolves.toEqual({ fetched: 0, skipped: 1 })
        expect(series).not.toHaveBeenCalled()
    })

    it('refetches provisional coverage and replaces the same segment', async () => {
        const repository = new MemoryRepository()
        const state = { provisional: true }
        const { insight, series } = withHistory(repository, state)

        await insight.history.sync({ range })
        expect([...repository.segments.values()][0]?.provisional).toBe(true)
        state.provisional = false
        await insight.history.sync({ range })

        expect(series).toHaveBeenCalledTimes(2)
        expect(repository.segments).toHaveLength(1)
        expect([...repository.segments.values()][0]?.provisional).toBeUndefined()
        await expect(insight.history.sync({ range })).resolves.toEqual({ fetched: 0, skipped: 1 })
    })

    it('merges stored and live ranges without overlap', async () => {
        const repository = new MemoryRepository()
        const { insight, series } = withHistory(repository)
        await insight.history.sync({
            range: { from: range.from, to: '2026-01-03T00:00:00.000Z' },
        })
        series.mockClear()

        const report = await insight.reports('app.usage').series({
            grain: 'day',
            metrics: ['views'],
            range,
        })

        expect(report.points).toHaveLength(4)
        expect(report.points.map(({ values }) => values.views)).toEqual([3, 3, 3, 3])
        expect(series).toHaveBeenCalledOnce()
        expect(series).toHaveBeenCalledWith(
            expect.objectContaining({
                range: { from: '2026-01-03T00:00:00.000Z', to: range.to },
            }),
        )
    })

    it('rolls additive and derived metrics and rejects unsafe rollup', async () => {
        const repository = new MemoryRepository()
        const { insight } = withHistory(repository)
        await insight.history.sync({ range })

        const report = await insight.reports('app.usage').series({
            grain: 'week',
            metrics: ['views', 'ctr'],
            range,
        })
        expect(report.points[0]?.values).toEqual({ ctr: 0.5, views: 12 })

        await expect(
            insight.reports('app.usage').series({ grain: 'week', metrics: ['peak'], range }),
        ).rejects.toMatchObject({ code: 'UNSAFE_ROLLUP' })
    })

    it('keeps Provider Quality separate from range-scoped reduced Fidelity', async () => {
        const repository = new MemoryRepository()
        const { provider } = reportProvider()
        const insight = createInsight({
            history: createHistory({
                reductions: {
                    'app.usage': [
                        {
                            range: {
                                from: range.from,
                                to: '2026-01-03T00:00:00.000Z',
                            },
                            transformations: [{ kind: 'sample', rate: 0.5 }],
                        },
                    ],
                },
                repository,
                sources: ['app.usage'],
            }),
            providers: [provider] as const,
        })
        await insight.history.sync({ range })

        const report = await insight.reports('app.usage').series({
            grain: 'day',
            metrics: ['views'],
            range,
        })
        expect(report.meta.quality).toMatchObject({ sampled: true })
        expect(report.meta.fidelity).toEqual([
            expect.objectContaining({
                preservation: 'reduced',
                range: { from: range.from, to: '2026-01-03T00:00:00.000Z' },
                transformations: [{ kind: 'sample', rate: 0.5 }],
            }),
            expect.objectContaining({
                preservation: 'full',
                range: { from: '2026-01-03T00:00:00.000Z', to: range.to },
            }),
        ])
    })
})

describe('snapshot History', () => {
    it('captures observations and exposes a generated series', async () => {
        const repository = new MemoryRepository()
        let now = new Date('2026-01-01T00:00:00.000Z')
        let online = 2
        const provider = defineProvider({
            id: 'status',
            reports: {
                current: {
                    history: { mode: 'snapshot' },
                    metrics: {
                        online: {
                            aggregation: 'last',
                            rollup: 'non-additive',
                            valueType: 'integer',
                        },
                    },
                    snapshot: async () => ({ values: { online } }),
                },
            },
        })
        const insight = createInsight({
            history: createHistory({ repository, sources: ['status.current'] }),
            now: () => now,
            providers: [provider] as const,
        })

        await insight.history.capture()
        now = new Date('2026-01-01T00:01:00.000Z')
        online = 5
        await insight.history.capture()

        const report = await insight.reports('status.current').series({
            grain: 'minute',
            metrics: ['online'],
            range: {
                from: '2026-01-01T00:00:00.000Z',
                to: '2026-01-01T00:02:00.000Z',
            },
        })
        expect(report.points.map(({ values }) => values.online)).toEqual([2, 5])
    })
})
