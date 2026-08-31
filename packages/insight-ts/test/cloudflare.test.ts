import { describe, expect, it, vi } from 'vitest'

import { createInsight, ProviderError } from '../src/core/index.ts'
import { CloudflareApiError, cloudflare } from '../src/providers/cloudflare/index.ts'

const time = {
    from: '2026-08-01T00:00:00.000Z',
    grain: 'hour' as const,
    to: '2026-08-02T00:00:00.000Z',
}

describe('Cloudflare adapters', () => {
    it('exposes adapters and rejects missing credentials before network I/O', async () => {
        const fetcher = vi.fn<(input: RequestInfo | URL, init?: RequestInit) => Promise<Response>>()
        const source = cloudflare({
            accountId: '',
            apiToken: '',
            webAnalytics: { fetch: fetcher, siteTag: 'site' },
        }).adapters.webAnalytics
        const query = source.normalize({ metrics: ['visits'], time })

        await expect(
            source.execute(query, {
                adapter: 'cloudflare.webAnalytics',
                provider: 'cloudflare',
                scope: 'default',
            }),
        ).rejects.toMatchObject({ code: 'CONFIGURATION_MISSING' })
        expect(fetcher).not.toHaveBeenCalled()
        expect(cloudflare({ webAnalytics: { siteTag: 'site' } })).toMatchObject({
            id: 'cloudflare',
            adapters: { webAnalytics: expect.any(Object) },
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
        const provider = cloudflare({
            accountId: 'account',
            apiToken: 'token',
            webAnalytics: {
                fetch: fetcher,
                siteTag: 'site',
            },
        })
        const insight = createInsight({ providers: [provider] })
        const dashboard = await insight.query((q) => ({
            traffic: q.metrics({
                dimensions: ['path'],
                metrics: ['pageViews', 'visits'],
                time,
                where: { country: 'JP' },
            }),
        }))

        expect(dashboard.traffic.data).toEqual({
            points: [
                {
                    dimensions: { path: '/docs' },
                    time: '2026-08-01T10:00:00.000Z',
                    values: { pageViews: 12, visits: 8 },
                },
            ],
            values: { pageViews: 12, visits: 8 },
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
        const source = cloudflare({
            accountId: 'account',
            apiToken: 'token',
            webAnalytics: { fetch: fetcher, siteTag: 'site' },
        }).adapters.webAnalytics
        const controller = new AbortController()
        const query = source.normalize({ metrics: ['visits'], time })
        await source.execute(query, {
            adapter: 'cloudflare.webAnalytics',
            provider: 'cloudflare',
            scope: 'default',
            signal: controller.signal,
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
        const provider = cloudflare({ analyticsEngine: { binding: { writeDataPoint } } })
        expect(provider.events).toBeDefined()
        expect(Object.hasOwn(provider.adapters, 'analyticsEngine')).toBe(false)
        expect(new CloudflareApiError('Unavailable', 503)).toBeInstanceOf(ProviderError)
    })
})
