import { createStorage } from 'unstorage'
import memoryDriver from 'unstorage/drivers/memory'
import { beforeEach, describe, expect, it, vi } from 'vitest'

import { googleSearchConsole } from '../src/google-search-console.ts'
import {
    createAnalytics,
    defineAnalyticsConfig,
    type AnalyticsAdapter,
    type AnalyticsMetricDescriptor,
    type AnalyticsReportMeta,
    type ResolvedAnalyticsQuery,
} from '../src/index.ts'

const now = new Date('2026-03-15T00:00:00.000Z')

function meta(source: string, bucketTimezone = 'UTC'): AnalyticsReportMeta {
    return {
        quality: {},
        queriedAt: now.toISOString(),
        source,
        temporal: { bucketTimezone },
    }
}

function days(query: ResolvedAnalyticsQuery): number {
    return (new Date(query.range.to).valueOf() - new Date(query.range.from).valueOf()) / 86_400_000
}

function archiveAdapter(
    metrics: readonly AnalyticsMetricDescriptor[],
    materializedMetrics = metrics.map(({ id }) => id),
    bucketTimezone = 'UTC',
): AnalyticsAdapter {
    return {
        dataset: {
            archive: [
                {
                    dimensions: ['time'],
                    grain: 'day',
                    id: 'daily',
                    metrics: materializedMetrics,
                    start: '2026-01-01T00:00:00.000Z',
                },
            ],
            dimensions: [{ id: 'time', valueType: 'datetime' }],
            domain: 'traffic',
            id: 'traffic',
            metrics,
        },
        query: vi.fn<AnalyticsAdapter['query']>(async (query: ResolvedAnalyticsQuery) => {
            const values = Object.fromEntries(
                query.metrics.map((metric) => {
                    const value = metric === 'impressions' ? days(query) * 4 : days(query) * 2
                    return [metric, metric === 'ctr' ? 0.5 : value]
                }),
            )
            return query.dimensions.length === 0
                ? { kind: 'scalar' as const, meta: meta(query.source, bucketTimezone), values }
                : {
                      kind: 'series' as const,
                      meta: meta(query.source, bucketTimezone),
                      points: Array.from({ length: days(query) }, (_, index) => ({
                          time: new Date(
                              new Date(query.range.from).valueOf() + index * 86_400_000,
                          ).toISOString(),
                          values: Object.fromEntries(
                              Object.keys(values).map((metric) => [
                                  metric,
                                  metric === 'impressions' ? 4 : metric === 'ctr' ? 0.5 : 2,
                              ]),
                          ),
                      })),
                  }
        }),
    }
}

const pageViews: AnalyticsMetricDescriptor = {
    aggregation: 'sum',
    id: 'pageViews',
    rollup: 'additive',
    valueType: 'integer',
}

describe('monthly archive', () => {
    let storage: ReturnType<typeof createStorage>

    beforeEach(() => {
        storage = createStorage({ driver: memoryDriver() })
    })

    it('writes deterministic JSON partitions and refreshes the current month idempotently', async () => {
        const source = archiveAdapter([pageViews])
        const analytics = createAnalytics({
            adapters: [source],
            archive: { storage },
            environment: 'test',
            name: 'project',
            now: () => now,
        })

        expect(await analytics.maintenance.run()).toEqual({ pruned: 0, refreshed: 3 })
        expect(await analytics.maintenance.run()).toEqual({ pruned: 0, refreshed: 1 })
        expect(await storage.getKeys()).toEqual([
            'analytics:v1:project:test:traffic:daily:2026-01',
            'analytics:v1:project:test:traffic:daily:2026-02',
            'analytics:v1:project:test:traffic:daily:2026-03',
            'analytics:v1:project:test:traffic:daily:index',
        ])
        expect(
            await storage.getItem('analytics:v1:project:test:traffic:daily:2026-02'),
        ).toMatchObject({
            schemaVersion: 1,
            source: 'traffic',
        })

        const february = await storage.getItem<any>(
            'analytics:v1:project:test:traffic:daily:2026-02',
        )
        await storage.setItem('analytics:v1:project:test:traffic:daily:2026-02', {
            ...february,
            project: 'other-project',
        })
        vi.mocked(source.query).mockClear()
        expect(await analytics.maintenance.run()).toEqual({ pruned: 0, refreshed: 2 })
        expect(source.query).toHaveBeenCalledTimes(2)
        expect(
            await storage.getItem('analytics:v1:project:test:traffic:daily:2026-02'),
        ).toMatchObject({ project: 'project' })
    })

    it('splits live edges from archived whole months without per-row I/O', async () => {
        const source = archiveAdapter([pageViews], ['pageViews'], 'America/Los_Angeles')
        const analytics = createAnalytics({
            adapters: [source],
            archive: { storage },
            name: 'project',
            now: () => now,
        })
        await analytics.maintenance.run()
        await storage.removeItem('analytics:v1:project:default:traffic:daily:2026-03')
        vi.mocked(source.query).mockClear()

        const report = await analytics.query({
            metrics: ['pageViews'],
            range: { from: '2026-01-15T00:00:00.000Z', to: '2026-03-10T00:00:00.000Z' },
        })

        expect(source.query).toHaveBeenCalledTimes(1)
        expect(report).toMatchObject({
            kind: 'scalar',
            meta: {
                quality: { imported: true },
                temporal: { bucketTimezone: 'America/Los_Angeles' },
            },
            values: { pageViews: 108 },
        })
    })

    it('uses later archive partitions after a middle-month hole', async () => {
        const source = archiveAdapter([pageViews])
        const analytics = createAnalytics({
            adapters: [source],
            archive: { storage },
            name: 'project',
            now: () => now,
        })
        await analytics.maintenance.run()
        await storage.removeItem('analytics:v1:project:default:traffic:daily:2026-02')
        vi.mocked(source.query).mockClear()

        const report = await analytics.query({
            metrics: ['pageViews'],
            range: {
                from: '2026-01-01T00:00:00.000Z',
                to: '2026-03-10T00:00:00.000Z',
            },
        })

        expect(source.query).toHaveBeenCalledOnce()
        expect(source.query).toHaveBeenCalledWith(
            expect.objectContaining({
                dimensions: ['time'],
                grain: 'day',
                range: {
                    from: '2026-02-01T00:00:00.000Z',
                    to: '2026-03-01T00:00:00.000Z',
                },
            }),
        )
        expect(report).toMatchObject({
            meta: { quality: { imported: true } },
            values: { pageViews: 136 },
        })
    })

    it('combines live data before materialized coverage with later partitions', async () => {
        const source = archiveAdapter([pageViews])
        const analytics = createAnalytics({
            adapters: [source],
            archive: { storage },
            name: 'project',
            now: () => now,
        })
        await analytics.maintenance.run()
        vi.mocked(source.query).mockClear()

        const report = await analytics.query({
            metrics: ['pageViews'],
            range: {
                from: '2025-12-15T00:00:00.000Z',
                to: '2026-02-01T00:00:00.000Z',
            },
        })

        expect(source.query).toHaveBeenCalledOnce()
        expect(source.query).toHaveBeenCalledWith(
            expect.objectContaining({
                dimensions: ['time'],
                grain: 'day',
                range: {
                    from: '2025-12-15T00:00:00.000Z',
                    to: '2026-01-01T00:00:00.000Z',
                },
            }),
        )
        expect(report).toMatchObject({
            meta: { quality: { imported: true } },
            values: { pageViews: 96 },
        })
    })

    it('rolls a daily archive into UTC weeks and months', async () => {
        const source = archiveAdapter([pageViews])
        source.validate = vi.fn<NonNullable<AnalyticsAdapter['validate']>>((query) => {
            if (query.grain !== 'day') throw new Error('Provider only accepts its native grain')
        })
        const analytics = createAnalytics({
            adapters: [source],
            archive: { storage },
            name: 'project',
            now: () => now,
        })
        await analytics.maintenance.run()
        vi.mocked(source.query).mockClear()

        const weekly = await analytics.traffic.series({
            grain: 'week',
            metrics: ['pageViews'],
            range: {
                from: '2026-01-01T00:00:00.000Z',
                to: '2026-02-01T00:00:00.000Z',
            },
        })
        const monthly = await analytics.traffic.series({
            grain: 'month',
            metrics: ['pageViews'],
            range: {
                from: '2026-01-01T00:00:00.000Z',
                to: '2026-02-01T00:00:00.000Z',
            },
        })

        expect(source.query).not.toHaveBeenCalled()
        expect(weekly.points.map(({ time, values }) => [time, values.pageViews])).toEqual([
            ['2025-12-29T00:00:00.000Z', 8],
            ['2026-01-05T00:00:00.000Z', 14],
            ['2026-01-12T00:00:00.000Z', 14],
            ['2026-01-19T00:00:00.000Z', 14],
            ['2026-01-26T00:00:00.000Z', 12],
        ])
        expect(monthly.points).toEqual([
            { time: '2026-01-01T00:00:00.000Z', values: { pageViews: 62 } },
        ])

        const acrossLiveEdge = await analytics.traffic.series({
            grain: 'week',
            metrics: ['pageViews'],
            range: {
                from: '2025-12-29T00:00:00.000Z',
                to: '2026-01-12T00:00:00.000Z',
            },
        })
        expect(source.validate).toHaveBeenLastCalledWith(
            expect.objectContaining({ dimensions: ['time'], grain: 'day' }),
        )
        expect(source.query).toHaveBeenCalledOnce()
        expect(acrossLiveEdge.points).toEqual([
            { time: '2025-12-29T00:00:00.000Z', values: { pageViews: 14 } },
            { time: '2026-01-05T00:00:00.000Z', values: { pageViews: 14 } },
        ])
    })

    it('keeps merged metrics null when any contributing value is unavailable', async () => {
        const source = archiveAdapter([pageViews])
        source.query = vi.fn<AnalyticsAdapter['query']>(async (query) => ({
            kind: 'series',
            meta: meta(query.source),
            points: [
                {
                    time: query.range.from,
                    values: {
                        pageViews: query.range.from.startsWith('2026-01') ? null : 2,
                    },
                },
            ],
        }))
        const analytics = createAnalytics({
            adapters: [source],
            archive: { storage },
            name: 'project',
            now: () => now,
        })
        await analytics.maintenance.run()
        vi.mocked(source.query).mockClear()

        const report = await analytics.query({
            metrics: ['pageViews'],
            range: {
                from: '2026-01-01T00:00:00.000Z',
                to: '2026-03-01T00:00:00.000Z',
            },
        })

        expect(source.query).not.toHaveBeenCalled()
        expect(report).toMatchObject({
            kind: 'scalar',
            meta: {
                quality: {
                    partial: true,
                    warnings: [{ code: 'null_metric_value' }],
                },
            },
            values: { pageViews: null },
        })
    })

    it('recomputes derived ratios from additive supporting metrics', async () => {
        const source = archiveAdapter(
            [
                {
                    aggregation: 'ratio',
                    derive: { denominator: 'impressions', numerator: 'clicks', operation: 'ratio' },
                    id: 'ctr',
                    rollup: 'derived',
                    valueType: 'ratio',
                },
                { aggregation: 'sum', id: 'clicks', rollup: 'additive', valueType: 'integer' },
                { aggregation: 'sum', id: 'impressions', rollup: 'additive', valueType: 'integer' },
            ],
            ['ctr'],
        )
        const analytics = createAnalytics({
            adapters: [source],
            archive: { storage },
            name: 'project',
            now: () => now,
        })
        await analytics.maintenance.run()

        const report = await analytics.query({
            metrics: ['ctr'],
            range: { from: '2026-01-15T00:00:00.000Z', to: '2026-03-10T00:00:00.000Z' },
        })

        expect(report).toMatchObject({ kind: 'scalar', values: { ctr: 0.5 } })
    })

    it('rolls temporal archive rows into a dimensional table', async () => {
        const source: AnalyticsAdapter = {
            dataset: {
                archive: [
                    {
                        dimensions: ['time', 'country'],
                        grain: 'day',
                        id: 'daily-country',
                        metrics: ['pageViews'],
                        start: '2026-01-01T00:00:00.000Z',
                    },
                ],
                dimensions: [
                    { id: 'time', valueType: 'datetime' },
                    { id: 'country', valueType: 'string' },
                ],
                domain: 'traffic',
                id: 'traffic-country',
                metrics: [pageViews],
            },
            query: vi.fn<AnalyticsAdapter['query']>(async (query) => ({
                kind: 'table',
                meta: meta(query.source),
                rows: Array.from({ length: days(query) }, (_, index) => ({
                    dimensions: {
                        country: 'JP',
                        time: new Date(
                            new Date(query.range.from).valueOf() + index * 86_400_000,
                        ).toISOString(),
                    },
                    metrics: { pageViews: 2 },
                })),
            })),
        }
        const analytics = createAnalytics({
            adapters: [source],
            archive: { storage },
            name: 'project',
            now: () => now,
        })
        await analytics.maintenance.run()
        vi.mocked(source.query).mockClear()

        const report = await analytics.query({
            dimensions: ['country'],
            metrics: ['pageViews'],
            range: { from: '2026-01-15T00:00:00.000Z', to: '2026-03-10T00:00:00.000Z' },
        })

        expect(source.query).not.toHaveBeenCalled()
        expect(report).toMatchObject({
            kind: 'table',
            rows: [{ dimensions: { country: 'JP' }, metrics: { pageViews: 108 } }],
        })
    })

    it('uses one live query when a metric cannot be safely rolled up', async () => {
        const source = archiveAdapter([
            {
                aggregation: 'unique',
                id: 'visitors',
                rollup: 'non-additive',
                valueType: 'integer',
            },
        ])
        const analytics = createAnalytics({
            adapters: [source],
            archive: { storage },
            name: 'project',
            now: () => now,
        })
        await analytics.maintenance.run()
        vi.mocked(source.query).mockClear()

        await analytics.query({
            metrics: ['visitors'],
            range: { from: '2026-01-01T00:00:00.000Z', to: '2026-03-01T00:00:00.000Z' },
        })

        expect(source.query).toHaveBeenCalledTimes(1)
    })

    it('prunes partitions by observation month and reports corrupt data', async () => {
        const source = archiveAdapter([pageViews])
        const initial = createAnalytics({
            adapters: [source],
            archive: { storage },
            name: 'project',
            now: () => now,
        })
        await initial.maintenance.run()
        await storage.removeItem('analytics:v1:project:default:traffic:daily:index')

        const retained = createAnalytics({
            adapters: [source],
            archive: { retention: '30d', storage },
            name: 'project',
            now: () => now,
        })
        expect(await retained.maintenance.run()).toEqual({ pruned: 2, refreshed: 1 })
        expect(
            await storage.getItem('analytics:v1:project:default:traffic:daily:2026-01'),
        ).toBeNull()
        const february = await storage.getItem<any>(
            'analytics:v1:project:default:traffic:daily:2026-02',
        )
        expect(february).toMatchObject({
            query: { range: { from: '2026-02-13T00:00:00.000Z' } },
        })
        expect(february.report.points[0].time).toBe('2026-02-13T00:00:00.000Z')
        vi.mocked(source.query).mockClear()
        expect(await retained.maintenance.run()).toEqual({ pruned: 0, refreshed: 1 })
        expect(source.query).toHaveBeenCalledTimes(1)
        vi.mocked(source.query).mockClear()
        const retainedReport = await retained.query({
            metrics: ['pageViews'],
            range: {
                from: '2026-02-01T00:00:00.000Z',
                to: '2026-03-01T00:00:00.000Z',
            },
        })
        expect(source.query).toHaveBeenCalledTimes(1)
        expect(retainedReport).toMatchObject({
            meta: { quality: { imported: true } },
            values: { pageViews: 56 },
        })

        await storage.setItem('analytics:v1:project:default:traffic:daily:2026-02', {
            ...february,
            report: {
                ...february.report,
                points: [
                    {
                        ...february.report.points[0],
                        values: { pageViews: 'not-a-number' },
                    },
                ],
            },
        })
        await expect(
            retained.query({
                metrics: ['pageViews'],
                range: { from: '2026-02-01T00:00:00.000Z', to: '2026-03-01T00:00:00.000Z' },
            }),
        ).rejects.toMatchObject({ code: 'ARCHIVE_CORRUPT' })
    })

    it('backfills known provider coverage on first maintenance', async () => {
        const fetcher = vi.fn<(input: RequestInfo | URL, init?: RequestInit) => Promise<Response>>(
            async (_input: RequestInfo | URL, _init?: RequestInit) =>
                new Response(JSON.stringify({ rows: [] }), {
                    headers: { 'content-type': 'application/json' },
                }),
        )
        const source = googleSearchConsole({
            auth: { getAccessToken: async () => 'token' },
            fetch: fetcher,
            property: 'sc-domain:example.com',
        })
        const analytics = createAnalytics({
            adapters: [source],
            archive: { storage },
            name: 'project',
            now: () => now,
        })

        expect(await analytics.maintenance.run()).toEqual({ pruned: 0, refreshed: 17 })
        expect(fetcher).toHaveBeenCalledTimes(17)
        expect(
            await storage.getItem<any>(
                'analytics:v1:project:default:google-search-console.search-analytics:daily-search:2024-11',
            ),
        ).toMatchObject({
            query: {
                range: {
                    from: '2024-11-15T00:00:00.000Z',
                    to: '2024-12-01T00:00:00.000Z',
                },
            },
        })
    })

    it('refreshes delayed Search Console data until the partition finalization window closes', async () => {
        let clock = new Date('2026-03-03T00:00:00.000Z')
        let februaryClicks = 1
        const fetcher = vi.fn<(input: RequestInfo | URL, init?: RequestInit) => Promise<Response>>(
            async (_input, init) => {
                const body = init?.body
                if (typeof body !== 'string') throw new TypeError('expected a JSON request body')
                return Response.json({
                    rows: body.includes('"endDate":"2026-02-28"')
                        ? [
                              {
                                  clicks: februaryClicks,
                                  ctr: februaryClicks / 10,
                                  impressions: 10,
                                  keys: ['2026-02-28'],
                                  position: 1,
                              },
                          ]
                        : [],
                })
            },
        )
        const source = googleSearchConsole({
            auth: { getAccessToken: async () => 'token' },
            fetch: fetcher,
            property: 'sc-domain:example.com',
        })
        const analytics = createAnalytics({
            adapters: [source],
            archive: { storage },
            name: 'project',
            now: () => clock,
        })
        const februaryKey =
            'analytics:v1:project:default:google-search-console.search-analytics:daily-search:2026-02'

        await analytics.maintenance.run()
        expect(await storage.getItem<any>(februaryKey)).toMatchObject({
            report: { points: [{ values: { clicks: 1 } }] },
        })

        februaryClicks = 3
        clock = new Date('2026-03-07T00:00:00.000Z')
        fetcher.mockClear()
        expect(await analytics.maintenance.run()).toEqual({ pruned: 0, refreshed: 2 })
        expect(fetcher).toHaveBeenCalledTimes(2)
        expect(await storage.getItem<any>(februaryKey)).toMatchObject({
            report: { points: [{ values: { clicks: 3 } }] },
        })

        februaryClicks = 5
        clock = new Date('2026-03-09T00:00:00.000Z')
        fetcher.mockClear()
        expect(await analytics.maintenance.run()).toEqual({ pruned: 0, refreshed: 1 })
        expect(fetcher).toHaveBeenCalledOnce()
        expect(await storage.getItem<any>(februaryKey)).toMatchObject({
            report: { points: [{ values: { clicks: 3 } }] },
        })
    })

    it('falls back to the current month when an adapter has no coverage metadata', async () => {
        let clock = now
        const source = archiveAdapter([pageViews])
        source.dataset.archive = [
            { dimensions: ['time'], grain: 'day', id: 'daily', metrics: ['pageViews'] },
        ]
        const analytics = createAnalytics({
            adapters: [source],
            archive: { storage },
            name: 'project',
            now: () => clock,
        })

        expect(await analytics.maintenance.run()).toEqual({ pruned: 0, refreshed: 1 })
        expect(
            await storage.getItem<any>('analytics:v1:project:default:traffic:daily:2026-03'),
        ).toMatchObject({
            query: {
                range: { from: '2026-03-01T00:00:00.000Z', to: '2026-03-15T00:00:00.000Z' },
            },
        })

        clock = new Date('2026-04-02T00:00:00.000Z')
        expect(await analytics.maintenance.run()).toEqual({ pruned: 0, refreshed: 2 })
        expect(
            await storage.getItem<any>('analytics:v1:project:default:traffic:daily:2026-03'),
        ).toMatchObject({ query: { range: { to: '2026-04-01T00:00:00.000Z' } } })
    })

    it('drops a partially expired partition that cannot be filtered safely', async () => {
        const source = archiveAdapter([pageViews])
        const initial = createAnalytics({
            adapters: [source],
            archive: { storage },
            name: 'project',
            now: () => now,
        })
        await initial.maintenance.run()
        const key = 'analytics:v1:project:default:traffic:daily:2026-02'
        const partition = await storage.getItem<any>(key)
        await storage.setItem(key, {
            ...partition,
            report: { kind: 'scalar', meta: meta('traffic'), values: { pageViews: 56 } },
        })

        const retained = createAnalytics({
            adapters: [source],
            archive: { retention: '30d', storage },
            name: 'project',
            now: () => now,
        })
        expect(await retained.maintenance.run()).toMatchObject({
            warnings: [{ code: 'archive_retention_partial_dropped' }],
        })
        expect(await storage.getItem(key)).toBeNull()
    })

    it('rejects sub-day State grain before archive I/O', async () => {
        const config = defineAnalyticsConfig({
            state: {
                collect: () => ({ reports: 1 }),
                metrics: { reports: {} },
            },
        })
        const analytics = createAnalytics({
            adapters: [],
            archive: { storage },
            config,
            name: 'project',
        })
        const getItem = vi.spyOn(storage, 'getItem')

        await Promise.all(
            (['minute', 'hour'] as const).map(async (grain) =>
                expect(
                    Reflect.apply(analytics.state.series, analytics.state, [
                        'reports',
                        { grain, range: '30d' },
                    ]),
                ).rejects.toMatchObject({ code: 'INVALID_QUERY' }),
            ),
        )
        expect(getItem).not.toHaveBeenCalled()
    })

    it('stores one daily State observation, preserves dimensions, and applies retention', async () => {
        let clock = new Date('2026-01-01T12:00:00.000Z')
        let reports = 10
        let active = 3
        const collect = vi.fn<
            () => Promise<{
                reports: number
                users: readonly { status: 'active' | 'banned'; value: number }[]
            }>
        >(async () => ({
            reports,
            users: [
                { status: 'active' as const, value: active },
                { status: 'banned' as const, value: 2 },
            ],
        }))
        const config = defineAnalyticsConfig({
            state: {
                collect,
                metrics: {
                    reports: {},
                    users: { dimensions: { status: ['active', 'banned'] } },
                },
            },
        } as const)
        const analytics = createAnalytics({
            adapters: [],
            archive: { retention: '1d', storage },
            config,
            name: 'project',
            now: () => clock,
        })

        await analytics.maintenance.run()
        reports = 12
        active = 4
        await analytics.maintenance.run()
        let partition = await storage.getItem<any>(
            'analytics:v1:project:default:state:observations:2026-01',
        )
        expect(partition.observations).toHaveLength(1)
        expect(partition.observations[0].values).toEqual({
            reports: 12,
            users: [
                { status: 'active', value: 4 },
                { status: 'banned', value: 2 },
            ],
        })

        clock = new Date('2026-01-02T12:00:00.000Z')
        reports = 15
        active = 5
        await analytics.maintenance.run()
        clock = new Date('2026-01-03T12:00:00.000Z')
        reports = 20
        active = 8
        expect(await analytics.maintenance.run()).toMatchObject({ pruned: 1, refreshed: 1 })

        partition = await storage.getItem<any>(
            'analytics:v1:project:default:state:observations:2026-01',
        )
        expect(partition.observations).toHaveLength(2)
        expect(collect).toHaveBeenCalledTimes(4)
        expect(collect).toHaveBeenLastCalledWith({ requested: ['reports', 'users'] })

        const reportSeries = await analytics.state.series('reports', {
            range: {
                from: '2026-01-01T00:00:00.000Z',
                to: '2026-01-04T00:00:00.000Z',
            },
        })
        const userSeries = await analytics.state.series('users', {
            grain: 'week',
            range: {
                from: '2026-01-01T00:00:00.000Z',
                to: '2026-01-04T00:00:00.000Z',
            },
        })
        expect(reportSeries.points).toEqual([
            { time: '2026-01-02T00:00:00.000Z', values: { reports: 15 } },
            { time: '2026-01-03T00:00:00.000Z', values: { reports: 20 } },
        ])
        expect(userSeries.points).toEqual([
            {
                dimensions: { status: 'active' },
                time: '2025-12-29T00:00:00.000Z',
                values: { users: 8 },
            },
            {
                dimensions: { status: 'banned' },
                time: '2025-12-29T00:00:00.000Z',
                values: { users: 2 },
            },
        ])

        await storage.removeItem('analytics:v1:project:default:state:observations:index')
        clock = new Date('2026-02-03T12:00:00.000Z')
        await analytics.maintenance.run()
        expect(
            await storage.getItem('analytics:v1:project:default:state:observations:2026-01'),
        ).toBeNull()

        const februaryState = await storage.getItem<any>(
            'analytics:v1:project:default:state:observations:2026-02',
        )
        await storage.setItem('analytics:v1:project:default:state:observations:2026-02', {
            ...februaryState,
            observations: [
                {
                    ...februaryState.observations[0],
                    values: { reports: 'not-a-number' },
                },
            ],
        })
        await expect(
            analytics.state.series('reports', {
                range: {
                    from: '2026-02-01T00:00:00.000Z',
                    to: '2026-02-04T00:00:00.000Z',
                },
            }),
        ).rejects.toMatchObject({ code: 'ARCHIVE_CORRUPT' })
    })
})
