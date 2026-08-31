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

describe('Google Search Console Source', () => {
    it('requires a host-owned access-token callback before network I/O', async () => {
        const fetcher = vi.fn<(input: RequestInfo | URL, init?: RequestInit) => Promise<Response>>()
        const provider = googleSearchConsole({
            auth: {},
            fetch: fetcher,
            property: 'sc-domain:example.com',
        })
        const source = provider.sources.searchAnalytics
        const query = source.normalize({ metrics: ['clicks'], time })

        await expect(
            source.execute(query, {
                provider: provider.id,
                source: 'google-search-console.searchAnalytics',
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
            search: q.source.googleSearchConsole.searchAnalytics({
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
        }).sources.searchAnalytics
        const query = source.normalize({ metrics: ['clicks'], time })
        await source.execute(query, {
            provider: 'google-search-console',
            signal: controller.signal,
            source: 'google-search-console.searchAnalytics',
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
})
