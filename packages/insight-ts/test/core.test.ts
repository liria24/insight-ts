import { describe, expect, expectTypeOf, it, vi } from 'vitest'

import {
    createInsight,
    type EventProperties,
    type EventDestination,
    InsightError,
    type ReportSourceDefinition,
    type ScalarReport,
    type SeriesQuery,
    type SeriesReport,
    type TableReport,
} from '../src/core/index.ts'
import { defineProvider } from '../src/core/provider.ts'

const range = {
    from: '2026-08-01T00:00:00.000Z',
    to: '2026-08-08T00:00:00.000Z',
} as const

function commerceProvider() {
    const summary = vi.fn<NonNullable<ReportSourceDefinition['summary']>>(async ({ metrics }) => ({
        quality: { partial: true },
        values: Object.fromEntries(metrics.map((metric) => [metric, metric === 'orders' ? 7 : 42])),
    }))
    const series = vi.fn<NonNullable<ReportSourceDefinition['series']>>(
        async ({ metrics, range: selectedRange }: SeriesQuery) => ({
            points: [
                {
                    time: selectedRange.from,
                    values: Object.fromEntries(
                        metrics.map((metric) => [metric, metric === 'orders' ? 4 : 24]),
                    ),
                },
            ],
        }),
    )
    const breakdown = vi.fn<NonNullable<ReportSourceDefinition['breakdown']>>(
        async ({ metrics }) => ({
            rows: [
                {
                    dimensions: { country: 'JP' },
                    metrics: Object.fromEntries(
                        metrics.map((metric) => [metric, metric === 'orders' ? 4 : 24]),
                    ),
                },
            ],
        }),
    )
    return {
        provider: defineProvider({
            id: 'commerce',
            reports: {
                orders: {
                    breakdown,
                    dimensions: { country: 'string', time: 'datetime' },
                    metrics: {
                        orders: {
                            aggregation: 'sum',
                            rollup: 'additive',
                            valueType: 'integer',
                        },
                        revenue: 'currency',
                    },
                    series,
                    summary,
                },
            },
        }),
        operations: { breakdown, series, summary },
    }
}

describe('Provider capability and Report Source API', () => {
    it('derives Source IDs and preserves selected metric/dimension result types', async () => {
        const { provider } = commerceProvider()
        const insight = createInsight({ providers: [provider] as const })
        const reports = insight.reports('commerce.orders')

        const summary = await reports.summary({ metrics: ['orders'], range })
        const series = await reports.series({ grain: 'day', metrics: ['orders', 'revenue'], range })
        const breakdown = await reports.breakdown({
            dimensions: ['country'],
            metrics: ['revenue'],
            range,
        })

        expectTypeOf(summary).toEqualTypeOf<ScalarReport<'orders', 'commerce.orders'>>()
        expectTypeOf(series).toEqualTypeOf<
            SeriesReport<'orders' | 'revenue', 'country' | 'time', 'commerce.orders'>
        >()
        expectTypeOf(breakdown).toEqualTypeOf<
            TableReport<'revenue', 'country', 'commerce.orders'>
        >()
        expect(summary).toMatchObject({
            kind: 'scalar',
            meta: { quality: { partial: true }, source: 'commerce.orders' },
            values: { orders: 7 },
        })
        expect(series.points[0]?.values).toEqual({ orders: 4, revenue: 24 })
        expect(breakdown.rows[0]).toEqual({
            dimensions: { country: 'JP' },
            metrics: { revenue: 24 },
        })
        expect(insight.sources()).toEqual([
            expect.objectContaining({
                id: 'commerce.orders',
                operations: ['summary', 'series', 'breakdown'],
                provider: 'commerce',
            }),
        ])
    })

    it('exposes only implemented operations', async () => {
        const provider = defineProvider({
            id: 'status',
            reports: {
                current: {
                    history: { mode: 'snapshot' },
                    metrics: { online: { aggregation: 'last', valueType: 'integer' } },
                    snapshot: async () => ({ values: { online: 3 } }),
                },
            },
        })
        const insight = createInsight({ providers: [provider] as const })
        const reports = insight.reports('status.current')

        await expect(reports.snapshot({ metrics: ['online'] })).resolves.toMatchObject({
            kind: 'scalar',
            values: { online: 3 },
        })
        // @ts-expect-error summary is not implemented by this Source
        void reports.summary
        expect(Object.keys(reports)).toEqual(['snapshot', 'series'])
    })

    it('validates absolute half-open ranges and schema before Provider I/O', async () => {
        const { operations, provider } = commerceProvider()
        const insight = createInsight({ providers: [provider] as const })
        const reports = insight.reports('commerce.orders')

        await expect(
            reports.summary({
                metrics: ['orders'],
                range: { from: range.from, to: range.from },
            }),
        ).rejects.toMatchObject({ code: 'INVALID_QUERY' })
        expect(operations.summary).not.toHaveBeenCalled()

        await reports.summary({
            filters: { field: 'country', operator: 'eq', value: 'JP' },
            metrics: ['orders'],
            range: {
                from: '2026-08-01T03:12:45.123Z',
                to: '2026-08-01T04:56:07.890Z',
            },
        })
        expect(operations.summary).toHaveBeenCalledWith(
            expect.objectContaining({
                range: {
                    from: '2026-08-01T03:12:45.123Z',
                    to: '2026-08-01T04:56:07.890Z',
                },
            }),
        )
    })

    it('rejects duplicate and manually dotted Provider/Source identifiers', () => {
        expect(() =>
            createInsight({
                providers: [
                    { id: 'duplicate', reports: {} },
                    { id: 'duplicate', reports: {} },
                ] as const,
            }),
        ).toThrow(InsightError)
        expect(() =>
            createInsight({
                providers: [{ id: 'manual.id', reports: {} }] as const,
            }),
        ).toThrow(/cannot contain a dot/)
    })
})

describe('events', () => {
    it('preserves typed event properties and Provider-owned delivery', async () => {
        const track = vi.fn<EventDestination['track']>()
        const options = {
            events: {
                search: {
                    properties: { resultCount: 'number', type: ['keyword', 'semantic'] },
                },
            },
            providers: [{ events: { track }, id: 'events' }] as const,
        } as const
        type SearchProperties = EventProperties<typeof options, 'search'>
        expectTypeOf<SearchProperties>().toEqualTypeOf<{
            readonly resultCount: number
            readonly type: 'keyword' | 'semantic'
        }>()

        const insight = createInsight(options)
        await insight.track('search', { resultCount: 4, type: 'semantic' })
        expect(track).toHaveBeenCalledWith(
            expect.objectContaining({ name: 'search', origin: 'server' }),
        )
    })
})
