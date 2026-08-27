import { describe, expect, it, vi } from 'vitest'

import {
    CloudflareApiError,
    cloudflareAnalyticsEngine,
    cloudflareWebAnalytics,
} from '../src/cloudflare.ts'
import type { CloudflareAnalyticsEngineBinding } from '../src/cloudflare.ts'
import type { ResolvedAnalyticsQuery } from '../src/core/types.ts'

type TestFetch = (input: RequestInfo | URL, init?: RequestInit) => Promise<Response>

function bodyText(init: RequestInit | undefined): string {
    if (typeof init?.body !== 'string') throw new TypeError('Expected a string request body')
    return init.body
}

function requestUrl(input: RequestInfo | URL): string {
    if (typeof input === 'string') return input
    return input instanceof URL ? input.href : input.url
}

function query(overrides: Partial<ResolvedAnalyticsQuery> = {}): ResolvedAnalyticsQuery {
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

describe('Cloudflare Web Analytics', () => {
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

        const report = await adapter.query(
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

        const report = await adapter.query(query())

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

        await expect(adapter.query(query())).resolves.toMatchObject({
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

        const result = adapter.query(query())
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
        const invalidFilters: NonNullable<ResolvedAnalyticsQuery['filters']>[] = [
            { dimension: 'path', operator: 'eq', value: ['/docs'] },
            { dimension: 'path', operator: 'in', value: '/docs' },
            { dimension: 'path', operator: 'not-in', value: [] },
        ]

        await Promise.all(
            invalidFilters.map(async (filters) => {
                await expect(adapter.query(query({ filters }))).rejects.toBeInstanceOf(TypeError)
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

        await expect(adapter.query(query())).rejects.toMatchObject({
            message: 'Cloudflare Web Analytics returned malformed rows',
            status: 502,
        })
    })
})

describe('Cloudflare Analytics Engine', () => {
    it('writes the fixed event envelope', async () => {
        const writeDataPoint = vi.fn<CloudflareAnalyticsEngineBinding['writeDataPoint']>()
        const resource = cloudflareAnalyticsEngine({ binding: { writeDataPoint } })

        await resource.sink?.track({
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
        const sink = cloudflareAnalyticsEngine({ binding: { writeDataPoint } }).sink

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
        }).adapter

        const report = await adapter?.query(
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
        }).adapter

        await expect(
            adapter?.query(
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
        }).adapter

        await expect(
            adapter?.query(
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
        }).adapter

        await expect(
            adapter?.query(
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
