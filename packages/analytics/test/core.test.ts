import { describe, expect, expectTypeOf, it, vi } from 'vitest'

import {
    AnalyticsError,
    createAnalytics,
    defineAnalyticsConfig,
    type AnalyticsEventProperties,
    type AnalyticsProvider,
    type AnalyticsSource,
    type AnalyticsSourceQueryContext,
    type ResolvedAnalyticsQuery,
} from '../src/index.ts'
import { defineAnalyticsProvider } from '../src/provider.ts'

const range = {
    from: '2026-08-01T00:00:00.000Z',
    to: '2026-08-08T00:00:00.000Z',
} as const

function provider(
    providerId = 'custom',
    sourceId = 'custom.traffic',
    domain = 'traffic',
): AnalyticsProvider {
    const source: AnalyticsSource = {
        dimensions: {
            country: { valueType: 'string' },
            time: { valueType: 'datetime' },
        },
        domain,
        id: sourceId,
        metrics: {
            pageViews: { aggregation: 'sum', rollup: 'additive', valueType: 'integer' },
            visits: { aggregation: 'sum', rollup: 'additive', valueType: 'integer' },
        },
        query: vi.fn<AnalyticsSource['query']>(
            async (query: ResolvedAnalyticsQuery, context: AnalyticsSourceQueryContext) => {
                if (query.dimensions.length === 0) {
                    return context.summary({
                        quality: { partial: true },
                        values: Object.fromEntries(query.metrics.map((metric) => [metric, 7])),
                    })
                }
                if (query.dimensions.includes('time')) {
                    return context.series({
                        points: [{ time: query.range.from, values: { pageViews: 4, visits: 3 } }],
                    })
                }
                return context.breakdown({
                    rows: [
                        {
                            dimensions: { country: 'JP' },
                            metrics: { pageViews: 4, visits: 3 },
                        },
                    ],
                })
            },
        ),
    }
    return defineAnalyticsProvider({ id: providerId, sources: [source] })
}

describe('Provider and Source API', () => {
    it('supports summary, series, breakdown, custom domains, and source scoping', async () => {
        const custom = provider('custom', 'custom.orders', 'commerce')
        const analytics = createAnalytics({ name: 'shop', providers: [custom] })

        const summary = await analytics.domain('commerce').summary({
            metrics: ['pageViews', 'visits'],
            range,
        })
        const series = await analytics.source('custom.orders').series({
            grain: 'day',
            metrics: ['pageViews'],
            range,
        })
        const breakdown = await analytics.domain('commerce').breakdown({
            dimensions: ['country'],
            metrics: ['visits'],
            range,
        })

        expect(summary).toMatchObject({
            kind: 'scalar',
            meta: { quality: { partial: true }, source: 'custom.orders' },
            values: { pageViews: 7, visits: 7 },
        })
        expect(series).toMatchObject({ kind: 'series', meta: { source: 'custom.orders' } })
        expect(breakdown).toMatchObject({
            kind: 'table',
            rows: [{ dimensions: { country: 'JP' } }],
        })
        expect(custom.sources[0]?.query).toHaveBeenCalledWith(
            expect.objectContaining({ dimensions: ['time'], range, source: 'custom.orders' }),
            expect.objectContaining({ series: expect.any(Function) }),
        )
    })

    it('catalogs one provider with multiple sources and multiple providers', () => {
        const first = provider('first', 'first.traffic')
        const second = provider('second', 'second.search', 'search')
        const firstExtra = provider('unused', 'first.product', 'product').sources[0]
        const analytics = createAnalytics({
            name: 'catalog',
            providers: [{ ...first, sources: [...first.sources, firstExtra!] }, second],
        })

        expect(analytics.sources()).toEqual([
            expect.objectContaining({ id: 'first.traffic', provider: 'first' }),
            expect.objectContaining({ id: 'first.product', provider: 'first' }),
            expect.objectContaining({ id: 'second.search', provider: 'second' }),
        ])
    })

    it('requires an explicit default when sources are ambiguous', async () => {
        const first = provider('first', 'first.traffic')
        const second = provider('second', 'second.traffic')
        const ambiguous = createAnalytics({ name: 'site', providers: [first, second] })

        await expect(
            ambiguous.traffic.summary({ metrics: ['pageViews'], range }),
        ).rejects.toMatchObject({ code: 'SOURCE_AMBIGUOUS' })

        const selected = createAnalytics({
            defaults: { traffic: 'second.traffic' },
            name: 'site',
            providers: [first, second],
        })
        await selected.traffic.summary({ metrics: ['pageViews'], range })
        expect(first.sources[0]?.query).not.toHaveBeenCalled()
        expect(second.sources[0]?.query).toHaveBeenCalledOnce()
    })

    it.each([
        [{ from: range.from, to: range.from }, 'equal endpoints'],
        [{ from: range.to, to: range.from }, 'reversed endpoints'],
        [{ from: 'invalid', to: range.to }, 'invalid from'],
        [{ from: range.from, to: 'invalid' }, 'invalid to'],
    ])('rejects %s before provider I/O', async (invalidRange, _label) => {
        const custom = provider()
        const analytics = createAnalytics({ name: 'site', providers: [custom] })

        await expect(
            analytics.traffic.summary({ metrics: ['pageViews'], range: invalidRange }),
        ).rejects.toMatchObject({ code: 'INVALID_QUERY' })
        expect(custom.sources[0]?.query).not.toHaveBeenCalled()
    })

    it('passes arbitrary absolute timestamps through as a half-open range', async () => {
        const custom = provider()
        const analytics = createAnalytics({ name: 'site', providers: [custom] })
        const arbitrary = {
            from: '2026-08-01T03:12:45.123Z',
            to: '2026-08-01T04:56:07.890Z',
        }

        await analytics.traffic.summary({ metrics: ['pageViews'], range: arbitrary })

        expect(custom.sources[0]?.query).toHaveBeenCalledWith(
            expect.objectContaining({ range: arbitrary }),
            expect.any(Object),
        )
    })

    it('keeps adjacent half-open ranges on the same boundary without overlap', async () => {
        const custom = provider()
        const analytics = createAnalytics({ name: 'site', providers: [custom] })
        const boundary = '2026-08-08T00:00:00.000Z'

        await analytics.traffic.summary({
            metrics: ['pageViews'],
            range: { from: '2026-08-01T00:00:00.000Z', to: boundary },
        })
        await analytics.traffic.summary({
            metrics: ['pageViews'],
            range: { from: boundary, to: '2026-08-15T00:00:00.000Z' },
        })

        const calls = vi.mocked(custom.sources[0]!.query).mock.calls
        expect(calls[0]?.[0].range.to).toBe(boundary)
        expect(calls[1]?.[0].range.from).toBe(boundary)
    })

    it('preserves literal metric and dimension keys on Provider definitions', () => {
        const typed = defineAnalyticsProvider({
            id: 'typed',
            sources: [
                {
                    dimensions: { time: { valueType: 'datetime' } },
                    domain: 'traffic',
                    id: 'typed.traffic',
                    metrics: {
                        pageViews: {
                            aggregation: 'sum',
                            rollup: 'additive',
                            valueType: 'integer',
                        },
                    },
                    query: (_query, context) => context.summary({ values: { pageViews: 1 } }),
                },
            ],
        })

        expectTypeOf<keyof (typeof typed.sources)[0]['metrics']>().toEqualTypeOf<'pageViews'>()
        expectTypeOf<keyof (typeof typed.sources)[0]['dimensions']>().toEqualTypeOf<'time'>()
    })

    it('rejects unsupported fields before provider I/O', async () => {
        const custom = provider()
        const analytics = createAnalytics({ name: 'site', providers: [custom] })

        await expect(
            analytics.query({ metrics: ['missing'], range, source: 'custom.traffic' }),
        ).rejects.toEqual(
            expect.objectContaining<Partial<AnalyticsError>>({ code: 'UNSUPPORTED_METRIC' }),
        )
        expect(custom.sources[0]?.query).not.toHaveBeenCalled()
    })
})

describe('flattened analytics config', () => {
    it('preserves typed events, state, and provider destinations', async () => {
        const destination = { track: vi.fn<(event: unknown) => void>() }
        const collect = vi.fn<() => Promise<{ reports: number }>>(async () => ({ reports: 12 }))
        const config = defineAnalyticsConfig({
            events: {
                search: {
                    properties: { resultCount: 'number', type: ['keyword', 'semantic'] },
                },
            },
            name: 'site',
            providers: [{ eventDestination: destination, id: 'events', sources: [] }],
            state: { collect, metrics: { reports: {} } },
        } as const)

        type SearchProperties = AnalyticsEventProperties<typeof config, 'search'>
        expectTypeOf<SearchProperties>().toEqualTypeOf<{
            readonly resultCount: number
            readonly type: 'keyword' | 'semantic'
        }>()

        const analytics = createAnalytics(config)
        await analytics.track('search', { resultCount: 4, type: 'semantic' })
        expect(destination.track).toHaveBeenCalledWith(
            expect.objectContaining({ name: 'search', origin: 'server' }),
        )
        await expect(analytics.state.current('reports')).resolves.toEqual({ reports: 12 })
        await expect(analytics.state.series('reports', { range })).rejects.toMatchObject({
            code: 'CAPABILITY_UNAVAILABLE',
        })
    })
})
