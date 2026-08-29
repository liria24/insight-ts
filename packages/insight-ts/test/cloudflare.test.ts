import { describe, expect, it, vi } from 'vitest'

import { createInsight, ProviderError } from '../src/core/index.ts'
import {
    CloudflareApiError,
    cloudflare,
    cloudflareAnalyticsEngine,
    cloudflareWebAnalytics,
} from '../src/providers/cloudflare/index.ts'

const time = {
    from: '2026-08-01T00:00:00.000Z',
    grain: 'hour' as const,
    to: '2026-08-02T00:00:00.000Z',
}

describe('Cloudflare Sources', () => {
    it('exposes Sources and rejects missing credentials before network I/O', async () => {
        const fetcher = vi.fn<(input: RequestInfo | URL, init?: RequestInit) => Promise<Response>>()
        const source = cloudflareWebAnalytics({
            accountId: '',
            apiToken: '',
            fetch: fetcher,
            siteTag: 'site',
        })
        const query = source.normalize({ metrics: ['visits'], time })

        await expect(
            source.execute(query, {
                provider: 'cloudflare',
                source: 'cloudflare.webAnalytics',
            }),
        ).rejects.toMatchObject({ code: 'CONFIGURATION_MISSING' })
        expect(fetcher).not.toHaveBeenCalled()
        expect(cloudflare({ webAnalytics: { siteTag: 'site' } })).toMatchObject({
            id: 'cloudflare',
            sources: { webAnalytics: expect.any(Object) },
        })
    })

    it('translates typed where and returns Metric data with sampling quality', async () => {
        const fetcher = vi.fn<(input: RequestInfo | URL, init?: RequestInit) => Promise<Response>>(
            async (_input, init) => {
                if (typeof init?.body !== 'string')
                    throw new TypeError('Expected a JSON request body')
                const body = JSON.parse(init.body)
                expect(body.variables.filter).toMatchObject({
                    AND: [expect.objectContaining({ siteTag: 'site' }), { countryName: 'JP' }],
                })
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
                                            dimensions: {
                                                path: '/docs',
                                                time: '2026-08-01T10:00:00Z',
                                            },
                                            sum: { visits: 8 },
                                        },
                                    ],
                                },
                            ],
                        },
                    },
                })
            },
        )
        const provider = {
            id: 'cloudflare',
            sources: {
                webAnalytics: cloudflareWebAnalytics({
                    accountId: 'account',
                    apiToken: 'token',
                    fetch: fetcher,
                    siteTag: 'site',
                }),
            },
        } as const
        const insight = createInsight({ providers: [provider] as const })
        const dashboard = await insight.query((q) => ({
            traffic: q.source('cloudflare.webAnalytics', {
                dimensions: ['path'],
                metrics: ['pageViews', 'visits'],
                time,
                where: { country: 'JP' },
            }),
        }))

        expect(dashboard.traffic.data).toEqual({
            pageViews: {
                points: [
                    { dimensions: { path: '/docs' }, time: '2026-08-01T10:00:00.000Z', value: 12 },
                ],
                value: 12,
            },
            visits: {
                points: [
                    { dimensions: { path: '/docs' }, time: '2026-08-01T10:00:00.000Z', value: 8 },
                ],
                value: 8,
            },
        })
        expect(dashboard.traffic.meta.quality).toMatchObject({
            approximate: true,
            sampled: true,
            sampleRate: 0.25,
        })
    })

    it('forwards AbortSignal and does not expose activeUsers', async () => {
        const fetcher = vi.fn<(input: RequestInfo | URL, init?: RequestInit) => Promise<Response>>(
            async (_input, init) => {
                expect(init?.signal).toBe(controller.signal)
                return Response.json({ data: { viewer: { accounts: [{ rows: [] }] } } })
            },
        )
        const source = cloudflareWebAnalytics({
            accountId: 'account',
            apiToken: 'token',
            fetch: fetcher,
            siteTag: 'site',
        })
        const controller = new AbortController()
        const query = source.normalize({ metrics: ['visits'], time })
        await source.execute(query, {
            provider: 'cloudflare',
            signal: controller.signal,
            source: 'cloudflare.webAnalytics',
        })
        const rejectsActiveUsers = () =>
            source.normalize({
                // @ts-expect-error online is an app KPI, not a Cloudflare native metric
                metrics: ['activeUsers'],
                time,
            })
        void rejectsActiveUsers
    })

    it('keeps Analytics Engine event and query capabilities independent', () => {
        const writeDataPoint =
            vi.fn<(point: { blobs?: string[]; doubles?: number[]; indexes?: string[] }) => void>()
        const resource = cloudflareAnalyticsEngine({ binding: { writeDataPoint } })
        expect(resource.events).toBeDefined()
        expect(resource.source).toBeUndefined()
        expect(new CloudflareApiError('Unavailable', 503)).toBeInstanceOf(ProviderError)
    })
})
