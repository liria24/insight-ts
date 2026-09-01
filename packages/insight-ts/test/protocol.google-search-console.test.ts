import { describe, expect, it, vi } from 'vitest'

import { createInsight, ProviderError } from '../src/core/index.ts'
import {
    GoogleSearchConsoleApiError,
    googleSearchConsole,
} from '../src/providers/google-search-console/index.ts'

const time = {
    from: '2026-08-01T07:00:00.000Z',
    grain: 'day' as const,
    to: '2026-08-02T07:00:00.000Z',
}

describe('Google Search Console adapter', () => {
    it('requires a host-owned access-token callback before network I/O', async () => {
        const fetcher = vi.fn<(input: RequestInfo | URL, init?: RequestInit) => Promise<Response>>()
        const provider = googleSearchConsole({
            auth: {},
            fetch: fetcher,
            property: 'sc-domain:example.com',
        })
        const source = provider.adapters.searchAnalytics
        const query = source.normalize({ metrics: ['clicks'], time })

        await expect(
            source.execute(query, {
                adapter: 'google-search-console.searchAnalytics',
                provider: provider.id,
                scope: 'default',
            }),
        ).rejects.toMatchObject({ code: 'CONFIGURATION_MISSING' })
        expect(fetcher).not.toHaveBeenCalled()
        expect(new GoogleSearchConsoleApiError('Unavailable', 503)).toBeInstanceOf(ProviderError)
    })

    it('translates typed filters and preserves Source-specific metadata', async () => {
        const getAccessToken = vi.fn<() => Promise<string>>(async () => 'access-token')
        const fetcher = vi.fn<(input: RequestInfo | URL, init?: RequestInit) => Promise<Response>>(
            async (input, init) => {
                const url = input instanceof Request ? input.url : input.toString()
                expect(url).toContain('/sites/sc-domain%3Aexample.com/searchAnalytics/query')
                expect(init?.headers).toMatchObject({ authorization: 'Bearer access-token' })
                if (typeof init?.body !== 'string')
                    throw new TypeError('Expected a JSON request body')
                expect(JSON.parse(init.body)).toMatchObject({
                    dataState: 'final',
                    dimensionFilterGroups: [
                        {
                            filters: [
                                { dimension: 'page', expression: '/docs', operator: 'contains' },
                            ],
                            groupType: 'and',
                        },
                    ],
                    dimensions: ['date', 'query'],
                    rowLimit: 25_000,
                    startRow: 0,
                })
                return Response.json({
                    rows: [
                        {
                            clicks: 4,
                            ctr: 0.5,
                            impressions: 8,
                            keys: ['2026-08-01', 'insight ts'],
                            position: 3,
                        },
                    ],
                })
            },
        )
        const provider = googleSearchConsole({
            auth: { getAccessToken },
            fetch: fetcher,
            property: 'sc-domain:example.com',
        })
        const insight = createInsight({ providers: [provider] })
        const dashboard = await insight.query((q) => ({
            search: q.metrics({
                dimensions: ['query'],
                metrics: ['clicks', 'impressions', 'ctr', 'averagePosition'],
                time,
                where: { page: { contains: '/docs' } },
            }),
        }))

        expect(getAccessToken).toHaveBeenCalledOnce()
        expect(fetcher).toHaveBeenCalledOnce()
        expect(dashboard.search.data.values).toEqual({
            averagePosition: 3,
            clicks: 4,
            ctr: 0.5,
            impressions: 8,
        })
        expect(dashboard.search.data.points?.[0]).toMatchObject({
            dimensions: { query: 'insight ts' },
            values: { averagePosition: 3, clicks: 4, ctr: 0.5, impressions: 8 },
        })
        expect(dashboard.search.meta).toMatchObject({
            quality: { partial: true },
            temporal: { sourceTimezone: 'America/Los_Angeles' },
        })
    })

    it('forwards AbortSignal and restricts operators by field', async () => {
        const controller = new AbortController()
        const fetcher = vi.fn<(input: RequestInfo | URL, init?: RequestInit) => Promise<Response>>(
            async (_input, init) => {
                expect(init?.signal).toBe(controller.signal)
                return Response.json({ rows: [] })
            },
        )
        const source = googleSearchConsole({
            auth: { getAccessToken: async () => 'token' },
            fetch: fetcher,
            property: 'sc-domain:example.com',
        }).adapters.searchAnalytics
        const query = source.normalize({ metrics: ['clicks'], time })
        await source.execute(query, {
            adapter: 'google-search-console.searchAnalytics',
            provider: 'google-search-console',
            scope: 'default',
            signal: controller.signal,
        })
        const rejectsContains = () =>
            source.normalize({
                metrics: ['clicks'],
                time,
                // @ts-expect-error country only exposes equality
                where: { country: { contains: 'jpn' } },
            })
        void rejectsContains
    })

    it('keeps execution limits advanced and separate from canonical query limits', async () => {
        for (const maxRows of [0, 1.5, Number.MAX_SAFE_INTEGER + 1]) {
            expect(() =>
                googleSearchConsole({
                    advanced: { maxRows },
                    auth: { getAccessToken: async () => 'token' },
                    property: 'sc-domain:example.com',
                }),
            ).toThrow('maxRows must be a positive safe integer')
        }

        const fetcher = vi.fn<(input: RequestInfo | URL, init?: RequestInit) => Promise<Response>>(
            async () =>
                Response.json({
                    rows: [
                        {
                            clicks: 1,
                            ctr: 0.5,
                            impressions: 2,
                            keys: ['2026-08-01', 'first'],
                            position: 1,
                        },
                        {
                            clicks: 2,
                            ctr: 0.5,
                            impressions: 4,
                            keys: ['2026-08-01', 'second'],
                            position: 2,
                        },
                    ],
                }),
        )
        const source = googleSearchConsole({
            advanced: { maxRows: 2 },
            auth: { getAccessToken: async () => 'token' },
            fetch: fetcher,
            property: 'sc-domain:example.com',
        }).adapters.searchAnalytics
        const result = await source.execute(
            source.normalize({ dimensions: ['query'], metrics: ['clicks'], time }),
            {
                adapter: 'google-search-console.searchAnalytics',
                provider: 'google-search-console',
                scope: 'default',
            },
        )

        expect(fetcher).toHaveBeenCalledOnce()
        expect(result.data.values.clicks).toBe(3)
        expect(result.quality?.warnings).toContainEqual(
            expect.objectContaining({ code: 'execution-limit' }),
        )

        fetcher.mockClear()
        const limited = await source.execute(
            source.normalize({ dimensions: ['query'], limit: 1, metrics: ['clicks'], time }),
            {
                adapter: 'google-search-console.searchAnalytics',
                provider: 'google-search-console',
                scope: 'default',
            },
        )
        const request = fetcher.mock.calls[0]?.[1]
        expect(
            typeof request?.body === 'string' ? JSON.parse(request.body) : undefined,
        ).toMatchObject({ rowLimit: 1 })
        expect(limited.quality?.warnings).not.toContainEqual(
            expect.objectContaining({ code: 'execution-limit' }),
        )
    })
})
