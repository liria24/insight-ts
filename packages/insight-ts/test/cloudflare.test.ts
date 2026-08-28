import { describe, expect, it, vi } from 'vitest'

import { ProviderError } from '../src/core/index.ts'
import type { Report, ReportSourceDefinition } from '../src/core/types.ts'
import {
    CloudflareApiError,
    cloudflare,
    cloudflareAnalyticsEngine,
    cloudflareWebAnalytics,
} from '../src/providers/cloudflare/index.ts'
import type { CloudflareAnalyticsEngineBinding } from '../src/providers/cloudflare/index.ts'
import type { ResolvedReportQuery } from '../src/providers/shared/types.ts'

type TestFetch = (input: RequestInfo | URL, init?: RequestInit) => Promise<Response>

function bodyText(init: RequestInit | undefined): string {
    if (typeof init?.body !== 'string') throw new TypeError('Expected a string request body')
    return init.body
}

function requestUrl(input: RequestInfo | URL): string {
    if (typeof input === 'string') return input
    return input instanceof URL ? input.href : input.url
}

function query(overrides: Partial<ResolvedReportQuery> = {}): ResolvedReportQuery {
    return {
        dimensions: [],
        grain: 'day',
        metrics: ['pageViews', 'visits'],
        range: { from: '2026-08-01T00:00:00.000Z', to: '2026-08-03T00:00:00.000Z' },
        source: 'cloudflare.web-analytics',
        timezone: 'UTC',
        ...overrides,
    }
}

async function run(source: ReportSourceDefinition, request: ResolvedReportQuery): Promise<Report> {
    const common = {
        ...(request.filters ? { filters: request.filters } : {}),
        metrics: request.metrics,
        range: request.range,
        timezone: request.timezone,
    }
    if (request.dimensions.length === 0) {
        const result = await source.summary!(common)
        return { kind: 'scalar', meta: testMeta(request, result), values: result.values }
    }
    if (request.dimensions.length === 1 && request.dimensions[0] === 'time') {
        const result = await source.series!({
            ...common,
            grain: request.grain === 'auto' ? 'day' : request.grain,
        })
        return { kind: 'series', meta: testMeta(request, result), points: result.points }
    }
    const result = await source.breakdown!({
        ...common,
        dimensions: request.dimensions,
        ...(request.grain === 'auto' ? {} : { grain: request.grain }),
        ...(request.limit === undefined ? {} : { limit: request.limit }),
    })
    return { kind: 'table', meta: testMeta(request, result), rows: result.rows }
}

function testMeta(
    request: ResolvedReportQuery,
    result: {
        freshness?: Report['meta']['freshness']
        quality?: Report['meta']['quality']
        temporal?: Report['meta']['temporal']
    },
): Report['meta'] {
    return {
        ...(result.freshness ? { freshness: result.freshness } : {}),
        quality: result.quality ?? {},
        queriedAt: '2026-08-28T00:00:00.000Z',
        source: request.source,
        temporal: result.temporal ?? {},
    }
}

describe('Cloudflare Web Analytics', () => {
    it('uses the common Provider error base for native API failures', () => {
        const error = new CloudflareApiError('Unavailable', 503, 'temporary')

        expect(error).toBeInstanceOf(ProviderError)
        expect(error).toMatchObject({ provider: 'cloudflare', retryable: true, status: 503 })
    })

    it('groups configured capabilities as one Provider and reports missing credentials by code', async () => {
        const provider = cloudflare({
            analyticsEngine: { dataset: 'events' },
            webAnalytics: { siteTag: 'site' },
        })

        expect(provider).toMatchObject({
            id: 'cloudflare',
            reports: {
                analyticsEngine: expect.any(Object),
                webAnalytics: expect.any(Object),
            },
        })
        await expect(run(provider.reports!.webAnalytics!, query())).rejects.toMatchObject({
            code: 'CONFIGURATION_MISSING',
        })
    })

    it('queries the account RUM dataset and preserves sampling quality', async () => {
        const fetcher = vi.fn<TestFetch>(async (_input, init) => {
            const body = JSON.parse(bodyText(init))
            expect(body.variables).toEqual({
                accountTag: 'account',
                filter: {
                    AND: [
                        {
                            datetime_geq: '2026-08-01T00:00:00.000Z',
                            datetime_lt: '2026-08-03T00:00:00.000Z',
                            siteTag: 'site',
                        },
                    ],
                },
                limit: 20,
            })
            expect(body.query).toContain('rumPageloadEventsAdaptiveGroups')
            expect(body.query).toContain('time: datetimeHour')
            expect(body.query).toContain('path: requestPath')
            return Response.json({
                data: {
                    viewer: {
                        accounts: [
                            {
                                rows: [
                                    {
                                        avg: { sampleInterval: 4 },
                                        count: 12,
                                        dimensions: { path: '/docs', time: '2026-08-01T10:00:00Z' },
                                        sum: { visits: 8 },
                                    },
                                ],
                            },
                        ],
                    },
                },
            })
        })
        const adapter = cloudflareWebAnalytics({
            accountId: 'account',
            apiToken: 'token',
            fetch: fetcher,
            siteTag: 'site',
        })

        const report = await run(
            adapter,
            query({ dimensions: ['time', 'path'], grain: 'hour', limit: 20 }),
        )

        expect(fetcher).toHaveBeenCalledOnce()
        expect(report).toMatchObject({
            kind: 'table',
            meta: { quality: { approximate: true, sampled: true } },
            rows: [
                {
                    dimensions: { path: '/docs', time: '2026-08-01T10:00:00Z' },
                    metrics: { pageViews: 12, visits: 8 },
                },
            ],
        })
    })

    it('scopes every query and the default dataset identity by host', async () => {
        const fetcher = vi.fn<TestFetch>(async (_input, init) => {
            const body = JSON.parse(bodyText(init))
            expect(body.variables.filter).toEqual({
                AND: [
                    {
                        datetime_geq: '2026-08-01T00:00:00.000Z',
                        datetime_lt: '2026-08-03T00:00:00.000Z',
                        siteTag: 'site',
                    },
                    { requestHost: 'analytics.liria.me' },
                ],
            })
            return Response.json({
                data: {
                    viewer: {
                        accounts: [
                            {
                                rows: [
                                    {
                                        avg: { sampleInterval: 1 },
                                        count: 3,
                                        sum: { visits: 2 },
                                    },
                                ],
                            },
                        ],
                    },
                },
            })
        })
        const adapter = cloudflareWebAnalytics({
            accountId: 'account',
            apiToken: 'token',
            fetch: fetcher,
            host: 'analytics.liria.me',
            siteTag: 'site',
        })

        await run(adapter, query())
    })

    it('keeps the configured host and user filters in the same AND filter', async () => {
        const fetcher = vi.fn<TestFetch>(async (_input, init) => {
            const body = JSON.parse(bodyText(init))
            expect(body.variables.filter.AND).toEqual([
                {
                    datetime_geq: '2026-08-01T00:00:00.000Z',
                    datetime_lt: '2026-08-03T00:00:00.000Z',
                    siteTag: 'site',
                },
                { requestHost: 'analytics.liria.me' },
                { requestPath: '/docs' },
            ])
            return Response.json({ data: { viewer: { accounts: [{ rows: [] }] } } })
        })
        const adapter = cloudflareWebAnalytics({
            accountId: 'account',
            apiToken: 'token',
            fetch: fetcher,
            host: 'analytics.liria.me',
            siteTag: 'site',
        })

        await run(
            adapter,
            query({
                filters: { field: 'path', operator: 'eq', value: '/docs' },
            }),
        )
    })

    it('estimates active users from visits observed in the last five minutes', async () => {
        const fetcher = vi.fn<TestFetch>(async (_input, init) => {
            const body = JSON.parse(bodyText(init))
            expect(body.query).toContain('sum { visits }')
            expect(body.variables.filter.AND[0]).toMatchObject({
                datetime_geq: '2026-08-03T11:55:00.000Z',
                datetime_lt: '2026-08-03T12:00:00.000Z',
            })
            return Response.json({
                data: {
                    viewer: {
                        accounts: [
                            {
                                rows: [
                                    {
                                        avg: { sampleInterval: 1 },
                                        sum: { visits: 4 },
                                    },
                                ],
                            },
                        ],
                    },
                },
            })
        })
        const adapter = cloudflareWebAnalytics({
            accountId: 'account',
            apiToken: 'token',
            fetch: fetcher,
            siteTag: 'site',
        })

        await expect(
            run(
                adapter,
                query({
                    grain: 'minute',
                    metrics: ['activeUsers'],
                    range: {
                        from: '2026-08-03T11:55:00.000Z',
                        to: '2026-08-03T12:00:00.000Z',
                    },
                }),
            ),
        ).resolves.toMatchObject({
            kind: 'scalar',
            meta: {
                quality: {
                    approximate: true,
                    warnings: [{ code: 'cloudflare-active-users-estimate' }],
                },
            },
            values: { activeUsers: 4 },
        })
    })

    it('rejects active user history before provider I/O', async () => {
        const fetcher = vi.fn<TestFetch>()
        const adapter = cloudflareWebAnalytics({
            accountId: 'account',
            apiToken: 'token',
            fetch: fetcher,
            siteTag: 'site',
        })

        await expect(
            run(
                adapter,
                query({
                    dimensions: ['time'],
                    metrics: ['activeUsers'],
                    range: {
                        from: '2026-08-03T11:55:00.000Z',
                        to: '2026-08-03T12:00:00.000Z',
                    },
                }),
            ),
        ).rejects.toThrow('scalar queries')
        await expect(
            run(
                adapter,
                query({
                    metrics: ['activeUsers'],
                    range: {
                        from: '2026-08-03T11:54:59.000Z',
                        to: '2026-08-03T12:00:00.000Z',
                    },
                }),
            ),
        ).rejects.toThrow('up to five minutes')
        expect(fetcher).not.toHaveBeenCalled()
    })

    it('keeps rows while surfacing GraphQL partial errors', async () => {
        const adapter = cloudflareWebAnalytics({
            accountId: 'account',
            apiToken: 'token',
            fetch: vi.fn<TestFetch>(async () =>
                Response.json({
                    data: {
                        viewer: {
                            accounts: [
                                {
                                    rows: [
                                        {
                                            avg: { sampleInterval: 1 },
                                            count: 3,
                                            sum: { visits: 2 },
                                        },
                                    ],
                                },
                            ],
                        },
                    },
                    errors: [{ extensions: { code: 'partial' }, message: 'One shard timed out' }],
                }),
            ),
            siteTag: 'site',
        })

        const report = await run(adapter, query())

        expect(report).toMatchObject({
            kind: 'scalar',
            meta: {
                quality: {
                    partial: true,
                    warnings: [{ code: 'partial', message: 'One shard timed out' }],
                },
            },
            values: { pageViews: 3, visits: 2 },
        })
    })

    it('retries transient GraphQL read failures', async () => {
        const fetcher = vi
            .fn<TestFetch>()
            .mockResolvedValueOnce(
                Response.json({}, { headers: { 'retry-after': '0' }, status: 503 }),
            )
            .mockResolvedValueOnce(
                Response.json({
                    data: {
                        viewer: {
                            accounts: [
                                {
                                    rows: [
                                        {
                                            avg: { sampleInterval: 1 },
                                            count: 3,
                                            sum: { visits: 2 },
                                        },
                                    ],
                                },
                            ],
                        },
                    },
                }),
            )
        const adapter = cloudflareWebAnalytics({
            accountId: 'account',
            apiToken: 'token',
            fetch: fetcher,
            siteTag: 'site',
        })

        await expect(run(adapter, query())).resolves.toMatchObject({
            kind: 'scalar',
            values: { pageViews: 3, visits: 2 },
        })
        expect(fetcher).toHaveBeenCalledTimes(2)
    })

    it('normalizes HTTP and GraphQL failures', async () => {
        const adapter = cloudflareWebAnalytics({
            accountId: 'account',
            apiToken: 'token',
            fetch: vi.fn<TestFetch>(async () =>
                Response.json(
                    { errors: [{ extensions: { code: 'rate_limited' }, message: 'Slow down' }] },
                    { headers: { 'retry-after': '0' }, status: 429 },
                ),
            ),
            siteTag: 'site',
        })

        const result = run(adapter, query())
        await expect(result).rejects.toBeInstanceOf(CloudflareApiError)
        await expect(result).rejects.toMatchObject({
            code: 'rate_limited',
            message: 'Slow down',
            status: 429,
        })
    })

    it('rejects invalid filter operand types before I/O', async () => {
        const fetcher = vi.fn<TestFetch>()
        const adapter = cloudflareWebAnalytics({
            accountId: 'account',
            apiToken: 'token',
            fetch: fetcher,
            siteTag: 'site',
        })
        const invalidFilters: NonNullable<ResolvedReportQuery['filters']>[] = [
            { field: 'path', operator: 'eq', value: ['/docs'] },
            { field: 'path', operator: 'in', value: '/docs' },
            { field: 'path', operator: 'not-in', value: [] },
        ]

        await Promise.all(
            invalidFilters.map(async (filters) => {
                await expect(run(adapter, query({ filters }))).rejects.toBeInstanceOf(TypeError)
            }),
        )
        expect(fetcher).not.toHaveBeenCalled()
    })

    it('rejects malformed Web Analytics rows', async () => {
        const adapter = cloudflareWebAnalytics({
            accountId: 'account',
            apiToken: 'token',
            fetch: vi.fn<TestFetch>(async () =>
                Response.json({ data: { viewer: { accounts: [{ rows: [{}] }] } } }),
            ),
            siteTag: 'site',
        })

        await expect(run(adapter, query())).rejects.toMatchObject({
            message: 'Cloudflare Web Analytics returned malformed rows',
            status: 502,
        })
    })
})

describe('Cloudflare Analytics Engine', () => {
    it('writes the fixed event envelope', async () => {
        const writeDataPoint = vi.fn<CloudflareAnalyticsEngineBinding['writeDataPoint']>()
        const resource = cloudflareAnalyticsEngine({ binding: { writeDataPoint } })

        await resource.events?.track({
            id: 'event-1',
            name: 'search',
            origin: 'client',
            properties: { results: 4 },
            timestamp: '2026-08-20T00:00:00.000Z',
        })

        expect(writeDataPoint).toHaveBeenCalledWith({
            blobs: ['search', '{"results":4}', 'client'],
            indexes: ['name:search'],
        })
    })

    it('rejects oversized indexes and blobs before writing', () => {
        const writeDataPoint = vi.fn<CloudflareAnalyticsEngineBinding['writeDataPoint']>()
        const sink = cloudflareAnalyticsEngine({ binding: { writeDataPoint } }).events

        expect(() =>
            sink?.track({
                id: 'event-2',
                name: 'あ'.repeat(31),
                origin: 'server',
                properties: {},
                timestamp: '2026-08-20T00:00:00.000Z',
            }),
        ).toThrow('index exceeds 96 bytes')
        expect(() =>
            sink?.track({
                id: 'event-3',
                name: 'event',
                origin: 'server',
                properties: { value: 'x'.repeat(16 * 1024) },
                timestamp: '2026-08-20T00:00:00.000Z',
            }),
        ).toThrow('blobs exceed 16384 bytes')
        expect(writeDataPoint).not.toHaveBeenCalled()
    })

    it('uses sampling-corrected SQL for event name breakdowns', async () => {
        const fetcher = vi.fn<TestFetch>(async (input, init) => {
            expect(requestUrl(input)).toBe(
                'https://api.cloudflare.com/client/v4/accounts/account/analytics_engine/sql',
            )
            expect(init?.headers).toEqual({ authorization: 'Bearer token' })
            expect(init?.body).toContain('SUM(_sample_interval) AS events')
            expect(init?.body).toContain('GROUP BY blob1')
            return Response.json({ data: [{ events: '9', name: 'search', sampleInterval: 3 }] })
        })
        const adapter = cloudflareAnalyticsEngine({
            accountId: 'account',
            apiToken: 'token',
            dataset: 'events_dataset',
            fetch: fetcher,
            now: () => new Date('2026-08-20T00:00:00.000Z'),
        }).report!

        const report = await run(
            adapter,
            query({
                dimensions: ['name'],
                metrics: ['events'],
                source: 'cloudflare.analytics-engine.events_dataset',
            }),
        )

        expect(report).toMatchObject({
            kind: 'table',
            meta: { quality: { approximate: true, sampled: true } },
            rows: [{ dimensions: { name: 'search' }, metrics: { events: 9 } }],
        })
    })

    it('rejects reads older than Analytics Engine retention before I/O', async () => {
        const fetcher = vi.fn<TestFetch>()
        const adapter = cloudflareAnalyticsEngine({
            accountId: 'account',
            apiToken: 'token',
            dataset: 'events_dataset',
            fetch: fetcher,
            now: () => new Date('2026-08-20T00:00:00.000Z'),
        }).report!

        await expect(
            run(
                adapter,
                query({
                    metrics: ['events'],
                    range: {
                        from: '2026-05-01T00:00:00.000Z',
                        to: '2026-05-02T00:00:00.000Z',
                    },
                    source: 'cloudflare.analytics-engine.events_dataset',
                }),
            ),
        ).rejects.toThrow('3-month retention')
        expect(fetcher).not.toHaveBeenCalled()
    })

    it('preserves numeric API error codes', async () => {
        const adapter = cloudflareAnalyticsEngine({
            accountId: 'account',
            apiToken: 'token',
            dataset: 'events_dataset',
            fetch: vi.fn<TestFetch>(async () =>
                Response.json(
                    { errors: [{ code: 10_000, message: 'Authentication error' }] },
                    { status: 403 },
                ),
            ),
            now: () => new Date('2026-08-20T00:00:00.000Z'),
        }).report!

        await expect(
            run(
                adapter,
                query({
                    metrics: ['events'],
                    source: 'cloudflare.analytics-engine.events_dataset',
                }),
            ),
        ).rejects.toMatchObject({ code: 10_000, message: 'Authentication error', status: 403 })
    })

    it('rejects malformed Analytics Engine rows', async () => {
        const adapter = cloudflareAnalyticsEngine({
            accountId: 'account',
            apiToken: 'token',
            dataset: 'events_dataset',
            fetch: vi.fn<TestFetch>(async () => Response.json({ data: [{}] })),
            now: () => new Date('2026-08-20T00:00:00.000Z'),
        }).report!

        await expect(
            run(
                adapter,
                query({
                    metrics: ['events'],
                    source: 'cloudflare.analytics-engine.events_dataset',
                }),
            ),
        ).rejects.toMatchObject({
            message: 'Cloudflare Analytics Engine returned malformed rows',
            status: 502,
        })
    })
})
