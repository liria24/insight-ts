import { describe, expect, it, vi } from 'vitest'

import { createInsight, defineProvider } from '../src/core/index.ts'
import { defineMetricAdapter, type MetricAdapterOutput } from '../src/metrics/index.ts'

const time = {
    from: '2026-08-01T00:00:00.000Z',
    to: '2026-08-02T00:00:00.000Z',
}

describe('Metrics contract', () => {
    it('normalizes filters and returns selected row-major Metric data', async () => {
        const dimensions = { country: 'JP' }
        const execute = vi.fn<
            () => {
                points: {
                    dimensions: { country: string }
                    time: string
                    values: { errors: number; requests: number }
                }[]
                values: { errors: number; requests: number }
            }
        >(() => ({
            points: [
                {
                    dimensions,
                    time: '2026-08-01T10:00:00Z',
                    values: { errors: 1, requests: 7 },
                },
            ],
            values: { errors: 1, requests: 7 },
        }))
        const adapter = defineMetricAdapter({
            dimensions: { country: { operators: ['eq'], type: 'string' } },
            execute,
            metrics: { errors: {}, requests: {} },
        })
        const insight = createInsight({
            providers: [defineProvider({ adapters: { usage: adapter }, id: 'app' })],
        })

        const result = await insight.metrics({
            dimensions: ['country'],
            metrics: ['requests'],
            time,
            where: { country: 'JP' },
        })

        expect(execute).toHaveBeenCalledWith(
            expect.objectContaining({
                metrics: ['requests'],
                projection: 'both',
                where: { field: 'country', operator: 'eq', value: 'JP' },
            }),
            expect.any(Object),
        )
        expect(result).toMatchObject({
            aggregate: { requests: 7 },
            rows: [
                {
                    dimensions,
                    time: '2026-08-01T10:00:00.000Z',
                    values: { requests: 7 },
                },
            ],
        })
        expect(result).not.toHaveProperty('data')
    })

    it('selects aggregate and row projections independently', async () => {
        const execute = vi.fn<
            (query: { projection: 'aggregate' | 'both' | 'rows' }) => MetricAdapterOutput
        >(() => ({
            points: [{ dimensions: { country: 'JP' }, values: { requests: 3 } }],
            values: { requests: 7 },
        }))
        const insight = createInsight({
            providers: [
                defineProvider({
                    adapters: {
                        usage: defineMetricAdapter({
                            dimensions: { country: 'string' },
                            execute,
                            metrics: { requests: {} },
                        }),
                    },
                    id: 'app',
                }),
            ],
        })

        const aggregate = await insight.metrics({
            metrics: ['requests'],
            projection: 'aggregate',
            time,
        })
        const defaultAggregate = await insight.metrics({ metrics: ['requests'], time })
        const rows = await insight.metrics({
            dimensions: ['country'],
            metrics: ['requests'],
            projection: 'rows',
            time,
        })
        const both = await insight.metrics({
            dimensions: ['country'],
            metrics: ['requests'],
            projection: 'both',
            time,
        })

        expect(aggregate).toMatchObject({ aggregate: { requests: 7 } })
        expect(aggregate).not.toHaveProperty('rows')
        expect(defaultAggregate).toMatchObject({ aggregate: { requests: 7 } })
        expect(defaultAggregate).not.toHaveProperty('rows')
        expect(rows).toMatchObject({ rows: [{ values: { requests: 3 } }] })
        expect(rows).not.toHaveProperty('aggregate')
        expect(both).toMatchObject({
            aggregate: { requests: 7 },
            rows: [{ values: { requests: 3 } }],
        })
        expect(execute.mock.calls.map(([query]) => query.projection)).toEqual([
            'aggregate',
            'aggregate',
            'rows',
            'both',
        ])
    })

    it('normalizes equivalent filters and rejects unsupported Metrics before I/O', async () => {
        const execute = vi.fn<() => { values: { requests: number } }>(() => ({
            values: { requests: 1 },
        }))
        const adapter = defineMetricAdapter({
            dimensions: { country: 'string' },
            execute,
            metrics: { requests: {} },
        })
        expect(
            adapter.key(
                adapter.normalize({ metrics: ['requests'], time, where: { country: 'JP' } }),
            ),
        ).toBe(
            adapter.key(
                adapter.normalize({
                    metrics: ['requests'],
                    time,
                    where: { country: { eq: 'JP' } },
                }),
            ),
        )
        const insight = createInsight({
            providers: [defineProvider({ adapters: { usage: adapter }, id: 'app' })],
        })

        await expect(
            insight.metrics({
                // @ts-expect-error runtime contract rejects invalid JavaScript callers
                metrics: ['missing'],
                time,
            }),
        ).rejects.toMatchObject({ code: 'UNSUPPORTED_METRIC' })
        await expect(
            insight.metrics({
                metrics: ['requests'],
                // @ts-expect-error runtime contract rejects invalid JavaScript callers
                projection: 'summary',
                time,
            }),
        ).rejects.toMatchObject({ code: 'INVALID_QUERY' })
        expect(execute).not.toHaveBeenCalled()
    })
})
