import { describe, expect, it, vi } from 'vitest'

import type { Report, ReportSourceDefinition } from '../src/core/types.ts'
import {
    GoogleSearchConsoleApiError,
    googleSearchConsole as googleSearchConsoleProvider,
} from '../src/providers/google-search-console/index.ts'
import type { ResolvedReportQuery } from '../src/providers/shared/types.ts'

type TestFetch = (input: RequestInfo | URL, init?: RequestInit) => Promise<Response>
function googleSearchConsole(options: Parameters<typeof googleSearchConsoleProvider>[0]) {
    return googleSearchConsoleProvider(options).reports.searchAnalytics
}

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
        metrics: ['clicks', 'impressions', 'ctr', 'averagePosition'],
        range: { from: '2026-08-01', to: '2026-08-03' },
        source: 'google-search-console.search-analytics',
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
    if (request.dimensions.length === 1 && ['date', 'hour'].includes(request.dimensions[0] ?? '')) {
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

describe('Google Search Console', () => {
    it('returns a Provider and reports a missing token callback by code', async () => {
        const provider = googleSearchConsoleProvider({
            auth: {},
            property: 'sc-domain:example.com',
        })

        expect(provider).toMatchObject({
            id: 'googleSearchConsole',
            reports: { searchAnalytics: expect.any(Object) },
        })
        await expect(run(provider.reports.searchAnalytics, query())).rejects.toMatchObject({
            code: 'CONFIGURATION_MISSING',
        })
    })

    it('gets one access token and paginates in 25,000 row pages', async () => {
        const getAccessToken = vi.fn<() => Promise<string>>(async () => 'access-token')
        const firstPage = Array.from({ length: 25_000 }, () => ({
            clicks: 1,
            ctr: 0.5,
            impressions: 2,
            keys: ['/page'],
            position: 3,
        }))
        const requests: Record<string, unknown>[] = []
        const fetcher = vi.fn<TestFetch>(async (input, init) => {
            expect(requestUrl(input)).toContain(
                '/sites/sc-domain%3Aexample.com/searchAnalytics/query',
            )
            expect(init?.headers).toMatchObject({ authorization: 'Bearer access-token' })
            requests.push(JSON.parse(bodyText(init)))
            return Response.json({
                rows:
                    requests.length === 1
                        ? firstPage
                        : [{ clicks: 2, ctr: 0.5, impressions: 4, keys: ['/last'], position: 5 }],
            })
        })
        const adapter = googleSearchConsole({
            auth: { getAccessToken },
            fetch: fetcher,
            property: 'sc-domain:example.com',
        })

        const report = await run(adapter, query({ dimensions: ['page'], limit: 25_001 }))

        expect(getAccessToken).toHaveBeenCalledOnce()
        expect(fetcher).toHaveBeenCalledTimes(2)
        expect(requests).toMatchObject([
            { dataState: 'final', rowLimit: 25_000, startRow: 0 },
            { dataState: 'final', rowLimit: 1, startRow: 25_000 },
        ])
        expect(report.kind).toBe('table')
        expect(report.kind === 'table' ? report.rows.length : -1).toBe(25_001)
    })

    it('recomputes ratio and weighted position for scalar results', async () => {
        const adapter = googleSearchConsole({
            auth: { getAccessToken: async () => 'token' },
            fetch: vi.fn<TestFetch>(async () =>
                Response.json({
                    rows: [
                        { clicks: 5, ctr: 0.5, impressions: 10, position: 2 },
                        { clicks: 5, ctr: 0.25, impressions: 20, position: 5 },
                    ],
                }),
            ),
            property: 'sc-domain:example.com',
        })

        const report = await run(adapter, query())

        expect(report).toMatchObject({
            kind: 'scalar',
            meta: {
                quality: {
                    partial: true,
                    warnings: expect.arrayContaining([
                        expect.objectContaining({ code: 'google-search-console-top-rows' }),
                        expect.objectContaining({ code: 'google-search-console-timezone' }),
                    ]),
                },
                temporal: {
                    bucketTimezone: 'America/Los_Angeles',
                    sourceTimezone: 'America/Los_Angeles',
                },
            },
            values: {
                averagePosition: 4,
                clicks: 10,
                ctr: 1 / 3,
                impressions: 30,
            },
        })
    })

    it('maps dimensions in request order and preserves incomplete metadata', async () => {
        const adapter = googleSearchConsole({
            auth: { getAccessToken: async () => 'token' },
            dataState: 'all',
            fetch: vi.fn<TestFetch>(async (_input, init) => {
                const body = JSON.parse(bodyText(init))
                expect(body).toMatchObject({
                    dataState: 'all',
                    dimensionFilterGroups: [
                        {
                            filters: [
                                { dimension: 'country', expression: 'JPN', operator: 'equals' },
                            ],
                            groupType: 'and',
                        },
                    ],
                    dimensions: ['country', 'device'],
                    endDate: '2026-08-02',
                    startDate: '2026-07-31',
                })
                return Response.json({
                    metadata: { first_incomplete_date: '2026-08-02' },
                    rows: [
                        {
                            clicks: 7,
                            ctr: 7 / 11,
                            impressions: 11,
                            keys: ['jpn', 'mobile'],
                            position: 3,
                        },
                    ],
                })
            }),
            property: 'sc-domain:example.com',
        })

        const report = await run(
            adapter,
            query({
                dimensions: ['country', 'device'],
                filters: { field: 'country', operator: 'eq', value: 'JPN' },
                metrics: ['clicks'],
                range: {
                    from: '2026-08-01T00:00:00.000Z',
                    to: '2026-08-03T00:00:00.000Z',
                },
            }),
        )

        expect(report).toMatchObject({
            kind: 'table',
            meta: { freshness: { incompleteFrom: '2026-08-02' } },
            rows: [{ dimensions: { country: 'jpn', device: 'mobile' }, metrics: { clicks: 7 } }],
        })
    })

    it('converts half-open instants to Search Console Pacific calendar dates', async () => {
        const requests: Record<string, unknown>[] = []
        const adapter = googleSearchConsole({
            auth: { getAccessToken: async () => 'token' },
            fetch: vi.fn<TestFetch>(async (_input, init) => {
                requests.push(JSON.parse(bodyText(init)))
                return Response.json({ rows: [] })
            }),
            property: 'sc-domain:example.com',
        })

        const report = await run(
            adapter,
            query({
                range: {
                    from: '2026-08-01T07:00:00.000Z',
                    to: '2026-08-03T07:00:00.000Z',
                },
            }),
        )

        expect(requests).toMatchObject([{ endDate: '2026-08-02', startDate: '2026-08-01' }])
        expect(report.meta.quality.warnings).not.toEqual(
            expect.arrayContaining([
                expect.objectContaining({ code: 'google-search-console-range-expanded' }),
            ]),
        )
    })

    it('assigns Pacific daily rows by their source bucket timestamp', async () => {
        const adapter = googleSearchConsole({
            auth: { getAccessToken: async () => 'token' },
            fetch: vi.fn<TestFetch>(async () =>
                Response.json({
                    rows: [
                        {
                            clicks: 1,
                            ctr: 0.5,
                            impressions: 2,
                            keys: ['2026-07-31'],
                            position: 1,
                        },
                        {
                            clicks: 3,
                            ctr: 0.75,
                            impressions: 4,
                            keys: ['2026-08-01'],
                            position: 2,
                        },
                        {
                            clicks: 5,
                            ctr: 5 / 6,
                            impressions: 6,
                            keys: ['2026-08-02'],
                            position: 3,
                        },
                    ],
                }),
            ),
            property: 'sc-domain:example.com',
        })

        const report = await run(
            adapter,
            query({
                dimensions: ['date'],
                metrics: ['clicks'],
                range: {
                    from: '2026-08-01T00:00:00.000Z',
                    to: '2026-08-02T00:00:00.000Z',
                },
            }),
        )

        expect(report).toMatchObject({
            kind: 'series',
            points: [{ time: '2026-08-01T07:00:00.000Z', values: { clicks: 3 } }],
        })
    })

    it('rejects grains that Search Console cannot produce', async () => {
        const adapter = googleSearchConsole({
            auth: { getAccessToken: async () => 'token' },
            property: 'sc-domain:example.com',
        })

        await expect(run(adapter, query({ dimensions: ['date'], grain: 'month' }))).rejects.toThrow(
            'only supports daily',
        )
    })

    it('rejects native dimension and filter limits before authentication', async () => {
        const getAccessToken = vi.fn<() => Promise<string>>(async () => 'token')
        const fetcher = vi.fn<TestFetch>()
        const adapter = googleSearchConsole({
            auth: { getAccessToken },
            fetch: fetcher,
            property: 'sc-domain:example.com',
        })
        const invalid = [
            query({ dimensions: ['page', 'page'] }),
            query({ filters: { field: 'date', operator: 'eq', value: '2026-08-01' } }),
            query({ filters: { field: 'country', operator: 'eq', value: 'jp' } }),
            query({ filters: { field: 'device', operator: 'eq', value: 'PHONE' } }),
            query({
                filters: { field: 'query', operator: 'contains', value: 'x'.repeat(4097) },
            }),
        ]

        await Promise.all(
            invalid.map(async (candidate) => {
                await expect(run(adapter, candidate)).rejects.toBeInstanceOf(TypeError)
            }),
        )
        expect(getAccessToken).not.toHaveBeenCalled()
        expect(fetcher).not.toHaveBeenCalled()
    })

    it('normalizes API errors', async () => {
        const adapter = googleSearchConsole({
            auth: { getAccessToken: async () => 'token' },
            fetch: vi.fn<TestFetch>(async () =>
                Response.json(
                    {
                        error: {
                            code: 401,
                            errors: [{ reason: 'authError' }],
                            message: 'Invalid Credentials',
                        },
                    },
                    { status: 401 },
                ),
            ),
            property: 'sc-domain:example.com',
        })

        const result = run(adapter, query())
        await expect(result).rejects.toBeInstanceOf(GoogleSearchConsoleApiError)
        await expect(result).rejects.toMatchObject({
            code: 'authError',
            message: 'Invalid Credentials',
            status: 401,
        })
    })

    it('retries rate-limited Search Analytics reads', async () => {
        const fetcher = vi
            .fn<TestFetch>()
            .mockResolvedValueOnce(
                Response.json({}, { headers: { 'retry-after': '0' }, status: 429 }),
            )
            .mockResolvedValueOnce(
                Response.json({
                    rows: [{ clicks: 1, ctr: 0.5, impressions: 2, position: 3 }],
                }),
            )
        const adapter = googleSearchConsole({
            auth: { getAccessToken: async () => 'token' },
            fetch: fetcher,
            property: 'sc-domain:example.com',
        })

        await expect(run(adapter, query())).resolves.toMatchObject({
            kind: 'scalar',
            values: { clicks: 1, impressions: 2 },
        })
        expect(fetcher).toHaveBeenCalledTimes(2)
    })

    it('rejects malformed provider rows', async () => {
        const adapter = googleSearchConsole({
            auth: { getAccessToken: async () => 'token' },
            fetch: vi.fn<TestFetch>(async () => Response.json({ rows: [{}] })),
            property: 'sc-domain:example.com',
        })

        await expect(run(adapter, query())).rejects.toMatchObject({
            message: 'Google Search Console returned malformed rows',
            status: 502,
        })
    })
})
