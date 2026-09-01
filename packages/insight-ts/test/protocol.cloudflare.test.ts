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
        const workers = cloudflare({
            accountId: '',
            apiToken: '',
            workersObservability: { fetch: fetcher },
        }).adapters.workersLogs
        await expect(
            workers.execute(workers.normalize({ time }), {
                adapter: 'cloudflare.workersLogs',
                provider: 'cloudflare',
                scope: 'default',
            }),
        ).rejects.toMatchObject({ code: 'CONFIGURATION_MISSING' })
        expect(fetcher).not.toHaveBeenCalled()
        expect(cloudflare({ webAnalytics: { siteTag: 'site' } })).toMatchObject({
            id: 'cloudflare',
            adapters: { webAnalytics: expect.any(Object) },
        })
        expect(cloudflare({ workersObservability: true }).adapters).toMatchObject({
            workersLogs: expect.any(Object),
            workersMetrics: expect.any(Object),
            workersTraces: expect.any(Object),
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

    it('maps Workers Logs filters, sampling, and native offsets behind opaque cursors', async () => {
        const bodies: Record<string, unknown>[] = []
        const fetcher = vi.fn<(input: RequestInfo | URL, init?: RequestInit) => Promise<Response>>(
            async (_input, init) => {
                const body = requestBody(init?.body)
                bodies.push(body)
                const offset = body.offset
                return Response.json({
                    result: {
                        events: {
                            events: offset
                                ? [
                                      {
                                          $metadata: {
                                              id: 'event-3',
                                              level: 'error',
                                              service: 'api',
                                          },
                                          source: { message: 'last' },
                                          timestamp: Date.parse('2026-08-01T01:00:00Z'),
                                      },
                                  ]
                                : [
                                      {
                                          $metadata: {
                                              id: 'event-1',
                                              level: 'error',
                                              service: 'api',
                                              spanId: 'span-1',
                                              traceId: 'trace-1',
                                          },
                                          $workers: { truncated: true },
                                          dataset: 'cloudflare-workers',
                                          source: { message: 'failed' },
                                          timestamp: Date.parse('2026-08-01T03:00:00Z'),
                                      },
                                      {
                                          $metadata: {
                                              id: 'event-2',
                                              level: 'warn',
                                              service: 'api',
                                          },
                                          source: 'retrying',
                                          timestamp: Date.parse('2026-08-01T02:00:00Z'),
                                      },
                                  ],
                        },
                        run: { status: 'COMPLETED' },
                        statistics: { abr_level: 4 },
                    },
                })
            },
        )
        const insight = createInsight({
            providers: [
                cloudflare({
                    accountId: 'account',
                    apiToken: 'token',
                    workersObservability: { fetch: fetcher },
                }),
            ],
        })
        const first = await insight.query((q) => ({
            logs: q.logs({
                limit: 2,
                time,
                where: { service: 'api', severity: 'error' },
            }),
        }))
        const second = await insight.query((q) => ({
            logs: q.logs({
                cursor: first.logs.meta.pagination!.next!,
                limit: 2,
                time,
                where: { service: 'api', severity: 'error' },
            }),
        }))

        expect(recordBody(bodies[0]).parameters).toMatchObject({
            filterCombination: 'and',
            filters: [
                { key: '$metadata.type', operation: 'eq', value: 'cf-worker-log' },
                { key: '$metadata.service', operation: 'eq', value: 'api' },
                { key: '$metadata.level', operation: 'eq', value: 'error' },
            ],
        })
        expect(bodies[1]).toMatchObject({ offset: 'event-2', offsetDirection: 'next' })
        expect(first.logs.data.logs[0]).toMatchObject({
            body: { message: 'failed' },
            id: 'event-1',
            service: 'api',
            severity: 'error',
            spanId: 'span-1',
            traceId: 'trace-1',
        })
        expect(first.logs.meta.quality).toMatchObject({
            approximate: true,
            partial: true,
            sampled: true,
            sampleRate: 0.25,
        })
        expect(second.logs.data.logs.map(({ id }) => id)).toEqual(['event-3'])
        expect(second.logs.meta.pagination).toBeUndefined()
    })

    it('maps Workers trace summaries and canonical filters', async () => {
        const fetcher = vi.fn<(input: RequestInfo | URL, init?: RequestInit) => Promise<Response>>(
            async (_input, init) => {
                const body = requestBody(init?.body)
                expect(recordBody(body).parameters).toMatchObject({
                    filters: [
                        { key: '$metadata.traceDuration', operation: 'gte', value: 50 },
                        { key: '$metadata.service', operation: 'eq', value: 'api' },
                        { key: '$metadata.error', operation: 'exists' },
                    ],
                })
                return Response.json({
                    result: {
                        run: { status: 'COMPLETED' },
                        traces: [
                            {
                                errors: ['boom'],
                                rootSpanName: 'fetch',
                                rootTransactionName: 'GET /checkout',
                                service: ['api'],
                                spans: 4,
                                traceDurationMs: 120,
                                traceEndMs: Date.parse('2026-08-01T03:00:00.120Z'),
                                traceId: 'trace-1',
                                traceStartMs: Date.parse('2026-08-01T03:00:00Z'),
                            },
                        ],
                    },
                })
            },
        )
        const insight = createInsight({
            providers: [
                cloudflare({
                    accountId: 'account',
                    apiToken: 'token',
                    workersObservability: { fetch: fetcher },
                }),
            ],
        })

        const result = await insight.query((q) => ({
            traces: q.traces({
                time,
                where: { durationMs: { gte: 50 }, service: 'api', status: 'error' },
            }),
        }))

        expect(result.traces.data.traces).toEqual([
            expect.objectContaining({
                durationMs: 120,
                name: 'GET /checkout',
                service: 'api',
                spanCount: 4,
                status: 'error',
                traceId: 'trace-1',
            }),
        ])
    })

    it('maps Workers telemetry calculations to canonical Metrics with Quality', async () => {
        const fetcher = vi.fn<(input: RequestInfo | URL, init?: RequestInit) => Promise<Response>>(
            async (_input, init) => {
                const body = requestBody(init?.body)
                expect(body).toMatchObject({
                    chart: true,
                    granularity: 24,
                    parameters: {
                        calculations: [
                            { alias: 'workerDurationP95', operator: 'p95' },
                            { alias: 'workerInvocations', operator: 'count' },
                        ],
                    },
                    view: 'calculations',
                })
                return Response.json({
                    result: {
                        calculations: [
                            {
                                aggregates: [{ sampleInterval: 2, value: 120 }],
                                alias: 'workerDurationP95',
                                series: [
                                    {
                                        data: [{ sampleInterval: 2, value: 120 }],
                                        time: '2026-08-01T00:00:00Z',
                                    },
                                ],
                            },
                            {
                                aggregates: [{ sampleInterval: 2, value: 50 }],
                                alias: 'workerInvocations',
                                series: [
                                    {
                                        data: [{ sampleInterval: 2, value: 50 }],
                                        time: '2026-08-01T00:00:00Z',
                                    },
                                ],
                            },
                        ],
                        run: { status: 'COMPLETED' },
                    },
                })
            },
        )
        const insight = createInsight({
            providers: [
                cloudflare({
                    accountId: 'account',
                    apiToken: 'token',
                    workersObservability: { fetch: fetcher },
                }),
            ],
        })

        const result = await insight.query((q) => ({
            workers: q.metrics({
                metrics: ['workerDurationP95', 'workerInvocations'],
                time,
            }),
        }))

        expect(result.workers.data.values).toEqual({
            workerDurationP95: 120,
            workerInvocations: 50,
        })
        expect(result.workers.data.points?.[0]?.values).toEqual({
            workerDurationP95: 120,
            workerInvocations: 50,
        })
        expect(result.workers.meta.quality).toMatchObject({
            approximate: true,
            sampled: true,
            sampleRate: 0.5,
        })
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

const recordBody = (value: unknown): Record<string, unknown> => {
    if (typeof value !== 'object' || value === null || Array.isArray(value)) {
        throw new TypeError('Expected an object')
    }
    return Object.fromEntries(Object.entries(value))
}

const requestBody = (value: BodyInit | null | undefined): Record<string, unknown> => {
    if (typeof value !== 'string') throw new TypeError('Expected a JSON request body')
    return recordBody(JSON.parse(value))
}
