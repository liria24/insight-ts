import { describe, expect, expectTypeOf, it, vi } from 'vitest'

import {
    AnalyticsError,
    createAnalytics,
    defineAnalyticsConfig,
    type AnalyticsAdapter,
    type AnalyticsEventProperties,
    type AnalyticsReportMeta,
    type ResolvedAnalyticsQuery,
} from '../src/index.ts'

function meta(source: string, quality: AnalyticsReportMeta['quality'] = {}): AnalyticsReportMeta {
    return {
        quality,
        queriedAt: '2026-08-20T00:00:00.000Z',
        source,
        temporal: {},
    }
}

function adapter(id: string, domain = 'traffic'): AnalyticsAdapter {
    return {
        dataset: {
            dimensions: [{ id: 'country' }, { id: 'time', valueType: 'datetime' }],
            domain,
            id,
            metrics: [
                {
                    aggregation: 'sum',
                    id: 'pageViews',
                    rollup: 'additive',
                    valueType: 'integer',
                },
            ],
        },
        query: vi.fn<AnalyticsAdapter['query']>(async (query: ResolvedAnalyticsQuery) =>
            query.dimensions.includes('time')
                ? {
                      kind: 'series' as const,
                      meta: meta(query.source, { partial: true }),
                      points: [
                          { time: query.range.from, values: { pageViews: query.metrics.length } },
                      ],
                  }
                : {
                      kind: 'scalar' as const,
                      meta: meta(query.source, { partial: true }),
                      values: { pageViews: query.metrics.length },
                  },
        ),
    }
}

describe('createAnalytics', () => {
    it('resolves one source and sends all requested metrics in one adapter call', async () => {
        const source = adapter('cloudflare')
        source.dataset.metrics = [
            ...source.dataset.metrics,
            { aggregation: 'sum', id: 'visits', rollup: 'additive', valueType: 'integer' },
        ]
        const analytics = createAnalytics({
            adapters: [source],
            name: 'example',
            now: () => new Date('2026-08-20T12:00:00.000Z'),
        })

        const report = await analytics.query({ metrics: ['pageViews', 'visits'], range: '7d' })

        expect(source.query).toHaveBeenCalledTimes(1)
        expect(source.query).toHaveBeenCalledWith(
            expect.objectContaining({
                metrics: ['pageViews', 'visits'],
                range: {
                    from: '2026-08-13T12:00:00.000Z',
                    to: '2026-08-20T12:00:00.000Z',
                },
                source: 'cloudflare',
            }),
        )
        expect(report.meta.quality.partial).toBe(true)
    })

    it('never silently selects between matching sources', async () => {
        const first = adapter('first')
        const second = adapter('second')
        const ambiguous = createAnalytics({ adapters: [first, second], name: 'example' })

        await expect(
            ambiguous.query({ metrics: ['pageViews'], range: '1d' }),
        ).rejects.toMatchObject({
            code: 'SOURCE_AMBIGUOUS',
        })

        const selected = createAnalytics({
            adapters: [first, second],
            defaultSources: { traffic: 'second' },
            name: 'example',
        })
        await selected.query({ metrics: ['pageViews'], range: '1d' })
        expect(first.query).not.toHaveBeenCalled()
        expect(second.query).toHaveBeenCalledTimes(1)
    })

    it('validates query shape before source selection', async () => {
        const analytics = createAnalytics({
            adapters: [adapter('first'), adapter('second')],
            name: 'example',
        })

        await expect(analytics.query({ metrics: [], range: '1d' })).rejects.toMatchObject({
            code: 'INVALID_QUERY',
        })
    })

    it('rejects unsupported fields before provider I/O', async () => {
        const source = adapter('cloudflare')
        const analytics = createAnalytics({ adapters: [source], name: 'example' })

        await expect(
            analytics.query({ metrics: ['missing'], range: '1d', source: 'cloudflare' }),
        ).rejects.toEqual(
            expect.objectContaining<Partial<AnalyticsError>>({ code: 'UNSUPPORTED_METRIC' }),
        )
        expect(source.query).not.toHaveBeenCalled()
    })

    it('flattens provider bundles and offers thin domain series queries', async () => {
        const source = adapter('cloudflare')
        const analytics = createAnalytics({
            adapters: [{ adapters: [source] }],
            name: 'example',
            now: () => new Date('2026-08-20T12:00:00.000Z'),
        })

        const report = await analytics.traffic.series({
            grain: 'day',
            metrics: ['pageViews'],
            range: '7d',
        })

        expect(report.kind).toBe('series')
        expect(source.query).toHaveBeenCalledWith(
            expect.objectContaining({ dimensions: ['time'], source: 'cloudflare' }),
        )
    })
})

describe('defineAnalyticsConfig', () => {
    it('preserves event names and property types', () => {
        const config = defineAnalyticsConfig({
            events: {
                search: {
                    properties: {
                        resultCount: 'number',
                        type: ['keyword', 'semantic'],
                    },
                },
                setupCreated: {},
            },
        } as const)

        type SearchProperties = AnalyticsEventProperties<typeof config, 'search'>
        expectTypeOf<SearchProperties>().toEqualTypeOf<{
            readonly resultCount: number
            readonly type: 'keyword' | 'semantic'
        }>()
        expect(config.events?.setupCreated).toEqual({})
    })

    it('collects requested state metrics once and rejects unavailable history', async () => {
        type StateNames = 'reports' | 'users'
        const collect = vi.fn<
            (context: { requested: readonly StateNames[] }) => Promise<{
                reports: number
                users: readonly { status: 'active' | 'banned'; value: number }[]
            }>
        >(async () => ({ reports: 12, users: [{ status: 'active', value: 5 }] }))
        const config = defineAnalyticsConfig({
            state: {
                collect,
                metrics: {
                    reports: {},
                    users: { dimensions: { status: ['active', 'banned'] } },
                },
            },
        } as const)
        const analytics = createAnalytics({ adapters: [], config, name: 'example' })

        const snapshot = await analytics.state.current(['users', 'reports'])

        expect(collect).toHaveBeenCalledOnce()
        expect(collect).toHaveBeenCalledWith({ requested: ['users', 'reports'] })
        expect(snapshot).toEqual({ reports: 12, users: [{ status: 'active', value: 5 }] })
        await expect(analytics.state.series('users', { range: '30d' })).rejects.toMatchObject({
            code: 'CAPABILITY_UNAVAILABLE',
        })
    })

    it('validates typed events and fans server events out to bundle sinks', async () => {
        const first = { track: vi.fn<(event: unknown) => void>() }
        const second = { track: vi.fn<(event: unknown) => Promise<void>>(async () => {}) }
        const events = {
            search: { properties: { resultCount: 'number', type: ['keyword', 'semantic'] } },
            setupCreated: {},
        } as const
        Reflect.setPrototypeOf(events, { inheritedEvent: {} })
        const config = defineAnalyticsConfig({
            events,
        })
        const analytics = createAnalytics({
            adapters: [
                { adapters: [], eventSink: first },
                { adapters: [], eventSink: second },
            ],
            config,
            name: 'example',
        })

        await analytics.track('search', { resultCount: 4, type: 'semantic' })

        expect(first.track).toHaveBeenCalledWith({
            id: expect.any(String),
            name: 'search',
            origin: 'server',
            properties: { resultCount: 4, type: 'semantic' },
            timestamp: expect.any(String),
        })
        expect(second.track).toHaveBeenCalledOnce()
        expect(first.track.mock.calls[0]?.[0]).toBe(second.track.mock.calls[0]?.[0])
        await analytics.track('setupCreated')
        expect(first.track).toHaveBeenLastCalledWith({
            id: expect.any(String),
            name: 'setupCreated',
            origin: 'server',
            properties: {},
            timestamp: expect.any(String),
        })
        const invalid = { resultCount: 4, type: 'semantic' as const }
        Reflect.set(invalid, 'resultCount', 'bad')
        await expect(analytics.track('search', invalid)).rejects.toMatchObject({
            code: 'INVALID_QUERY',
        })

        const inheritedProperties = {}
        Reflect.setPrototypeOf(inheritedProperties, { resultCount: 4, type: 'semantic' })
        await expect(
            Reflect.apply(analytics.track, analytics, ['search', inheritedProperties]),
        ).rejects.toMatchObject({ code: 'INVALID_QUERY' })
        await expect(
            Reflect.apply(analytics.track, analytics, ['inheritedEvent']),
        ).rejects.toMatchObject({ code: 'INVALID_QUERY' })
        await expect(
            analytics.track('search', { resultCount: Number.NaN, type: 'semantic' }),
        ).rejects.toMatchObject({ code: 'INVALID_QUERY' })
        await expect(
            analytics.track('search', { resultCount: Number.POSITIVE_INFINITY, type: 'semantic' }),
        ).rejects.toMatchObject({ code: 'INVALID_QUERY' })
        expect(first.track).toHaveBeenCalledTimes(2)
    })

    it('does not treat object prototype names as configured events or State metrics', async () => {
        const collect = vi.fn<() => Promise<{ reports: number }>>(async () => ({ reports: 1 }))
        const config = defineAnalyticsConfig({
            events: { reportViewed: {} },
            state: { collect, metrics: { reports: {} } },
        })
        const analytics = createAnalytics({ adapters: [], config, name: 'example' })

        await expect(Reflect.apply(analytics.track, analytics, ['toString'])).rejects.toMatchObject(
            {
                code: 'INVALID_QUERY',
            },
        )
        await expect(
            Reflect.apply(analytics.track, analytics, ['__proto__']),
        ).rejects.toMatchObject({ code: 'INVALID_QUERY' })
        await expect(
            Reflect.apply(analytics.state.current, analytics.state, ['toString']),
        ).rejects.toMatchObject({ code: 'UNSUPPORTED_METRIC' })
        await expect(
            Reflect.apply(analytics.state.current, analytics.state, ['__proto__']),
        ).rejects.toMatchObject({ code: 'UNSUPPORTED_METRIC' })
        expect(collect).not.toHaveBeenCalled()
    })
})
