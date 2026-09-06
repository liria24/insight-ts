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
                    AND: [
                        expect.objectContaining({ siteTag: 'site' }),
                        {
                            AND: [
                                { countryName: 'JP' },
                                { countryName_in: ['JP', 'US'] },
                                { countryName_neq: 'CA' },
                                { countryName_notin: ['GB'] },
                            ],
                        },
                    ],
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
                where: {
                    country: {
                        eq: 'JP',
                        in: ['JP', 'US'],
                        ne: 'CA',
                        notIn: ['GB'],
                    },
                },
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
        expect(() =>
            provider.adapters.webAnalytics.normalize({
                metrics: ['visits'],
                time,
                // @ts-expect-error Web Analytics does not advertise contains
                where: { country: { contains: 'JP' } },
            }),
        ).toThrow('does not support operator "contains"')
        expect(fetcher).toHaveBeenCalledOnce()
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
        const provider = cloudflare({
            accountId: 'account',
            apiToken: 'token',
            workersObservability: { fetch: fetcher },
        })
        const insight = createInsight({ providers: [provider] })
        const where = {
            attributes: {
                boolEq: true,
                boolIn: { in: [true, false] },
                boolNe: { ne: false },
                boolNotIn: { notIn: [false, true] },
                numberEq: 1,
                numberIn: { in: [1, 2] },
                numberNe: { ne: 2 },
                numberNotIn: { notIn: [3, 4] },
                textEq: 'one',
                textIn: { in: ['one', 'two'] },
                textNe: { ne: 'two' },
                textNotIn: { notIn: ['three', 'four'] },
            },
            service: 'api',
            severity: 'error',
        } as const
        const first = await insight.query((q) => ({
            logs: q.logs({ limit: 2, time, where }),
        }))
        const second = await insight.query((q) => ({
            logs: q.logs({
                cursor: first.logs.meta.pagination!.next!,
                limit: 2,
                time,
                where,
            }),
        }))

        const parameters = recordBody(recordBody(bodies[0]).parameters)
        expect(parameters.filterCombination).toBe('and')
        expectTelemetryFilters(parameters.filters, [
            ['$metadata.type', 'eq', 'string', 'cf-worker-log'],
            ['$metadata.service', 'eq', 'string', 'api'],
            ['$metadata.level', 'eq', 'string', 'error'],
            ['$metadata.boolEq', 'eq', 'boolean', true],
            ['$metadata.boolIn', 'in', 'boolean', 'true,false'],
            ['$metadata.boolNe', 'neq', 'boolean', false],
            ['$metadata.boolNotIn', 'not_in', 'boolean', 'false,true'],
            ['$metadata.numberEq', 'eq', 'number', 1],
            ['$metadata.numberIn', 'in', 'number', '1,2'],
            ['$metadata.numberNe', 'neq', 'number', 2],
            ['$metadata.numberNotIn', 'not_in', 'number', '3,4'],
            ['$metadata.textEq', 'eq', 'string', 'one'],
            ['$metadata.textIn', 'in', 'string', 'one,two'],
            ['$metadata.textNe', 'neq', 'string', 'two'],
            ['$metadata.textNotIn', 'not_in', 'string', 'three,four'],
        ])
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

        const source = provider.adapters.workersLogs
        await expect(
            source.execute(
                source.normalize({
                    time,
                    where: { attributes: { mixed: { in: [1, 'two'] } } },
                }),
                {
                    adapter: 'cloudflare.workersLogs',
                    provider: provider.id,
                    scope: 'default',
                },
            ),
        ).rejects.toThrow('requires one scalar type')
        expect(fetcher).toHaveBeenCalledTimes(2)
    })

    it('maps Workers trace summaries and canonical filters', async () => {
        const fetcher = vi.fn<(input: RequestInfo | URL, init?: RequestInit) => Promise<Response>>(
            async (_input, init) => {
                const body = requestBody(init?.body)
                const parameters = recordBody(recordBody(body).parameters)
                expectTelemetryFilters(parameters.filters, [
                    ['$metadata.boolEq', 'eq', 'boolean', true],
                    ['$metadata.boolIn', 'in', 'boolean', 'true,false'],
                    ['$metadata.boolNe', 'neq', 'boolean', false],
                    ['$metadata.boolNotIn', 'not_in', 'boolean', 'false,true'],
                    ['$metadata.traceDuration', 'eq', 'number', 10],
                    ['$metadata.traceDuration', 'gt', 'number', 30],
                    ['$metadata.traceDuration', 'gte', 'number', 40],
                    ['$metadata.traceDuration', 'in', 'number', '70,80'],
                    ['$metadata.traceDuration', 'lt', 'number', 50],
                    ['$metadata.traceDuration', 'lte', 'number', 60],
                    ['$metadata.traceDuration', 'neq', 'number', 20],
                    ['$metadata.traceDuration', 'not_in', 'number', '90,100'],
                    ['$metadata.service', 'eq', 'string', 'api'],
                    ['$metadata.service', 'in', 'string', 'api,jobs'],
                    ['$metadata.service', 'neq', 'string', 'web'],
                    ['$metadata.service', 'not_in', 'string', 'web'],
                    ['$metadata.error', 'exists', 'string'],
                ])
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
        const provider = cloudflare({
            accountId: 'account',
            apiToken: 'token',
            workersObservability: { fetch: fetcher },
        })
        const insight = createInsight({ providers: [provider] })

        const result = await insight.query((q) => ({
            traces: q.traces({
                time,
                where: {
                    attributes: {
                        boolEq: true,
                        boolIn: { in: [true, false] },
                        boolNe: { ne: false },
                        boolNotIn: { notIn: [false, true] },
                    },
                    durationMs: {
                        eq: 10,
                        gt: 30,
                        gte: 40,
                        in: [70, 80],
                        lt: 50,
                        lte: 60,
                        ne: 20,
                        notIn: [90, 100],
                    },
                    service: {
                        eq: 'api',
                        in: ['api', 'jobs'],
                        ne: 'web',
                        notIn: ['web'],
                    },
                    status: 'error',
                },
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

        const source = provider.adapters.workersTraces
        await expect(
            source.execute(source.normalize({ time, where: { status: { in: ['ok', 'error'] } } }), {
                adapter: 'cloudflare.workersTraces',
                provider: provider.id,
                scope: 'default',
            }),
        ).rejects.toThrow('supports only eq/ne ok/error')
        expect(fetcher).toHaveBeenCalledOnce()
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

    it('translates the Analytics Engine name equality filter before SQL execution', async () => {
        const fetcher = vi.fn<(input: RequestInfo | URL, init?: RequestInit) => Promise<Response>>(
            async (_input, init) => {
                expect(init?.body).toContain("blob1 = 'deploy\\'s'")
                return Response.json({
                    data: [
                        {
                            events: 2,
                            sampleInterval: 1,
                            time: '2026-08-01T00:00:00.000Z',
                        },
                    ],
                })
            },
        )
        const provider = cloudflare({
            accountId: 'account',
            apiToken: 'token',
            analyticsEngine: { dataset: 'events', fetch: fetcher },
        })
        const source = provider.adapters.analyticsEngine

        expect(() =>
            source.normalize({
                metrics: ['events'],
                time,
                // @ts-expect-error Analytics Engine advertises equality only
                where: { name: { ne: 'deploy' } },
            }),
        ).toThrow('does not support operator "ne"')
        expect(fetcher).not.toHaveBeenCalled()

        const result = await source.execute(
            source.normalize({ metrics: ['events'], time, where: { name: "deploy's" } }),
            {
                adapter: 'cloudflare.analyticsEngine',
                provider: provider.id,
                scope: 'default',
            },
        )
        expect(result.data.values).toEqual({ events: 2 })
        expect(fetcher).toHaveBeenCalledOnce()
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

type TelemetryFilterFixture = readonly [
    key: string,
    operation: string,
    type: string,
    value?: unknown,
]

const expectTelemetryFilters = (
    actual: unknown,
    fixtures: readonly TelemetryFilterFixture[],
): void => {
    expect(actual).toEqual(
        expect.arrayContaining(
            fixtures.map((fixture) => {
                const [key, operation, type, value] = fixture
                return expect.objectContaining({
                    key,
                    kind: 'filter',
                    operation,
                    type,
                    ...(fixture.length === 4 ? { value } : {}),
                })
            }),
        ),
    )
}
