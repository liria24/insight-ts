import { describe, expect, it, vi } from 'vitest'

import { createInsight, defineProvider } from '../src/core/index.ts'
import { defineMetricAdapter } from '../src/metrics/index.ts'

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

        const result = await insight.query((q) => ({
            usage: q.metrics({
                dimensions: ['country'],
                metrics: ['requests'],
                time,
                where: { country: 'JP' },
            }),
        }))

        expect(execute).toHaveBeenCalledWith(
            expect.objectContaining({
                metrics: ['requests'],
                where: { field: 'country', operator: 'eq', value: 'JP' },
            }),
            expect.any(Object),
        )
        expect(result.usage.data).toEqual({
            points: [
                {
                    dimensions,
                    time: '2026-08-01T10:00:00.000Z',
                    values: { requests: 7 },
                },
            ],
            values: { requests: 7 },
        })
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
            insight.query((q) => ({
                invalid: q.metrics({
                    // @ts-expect-error runtime contract rejects invalid JavaScript callers
                    metrics: ['missing'],
                    time,
                }),
            })),
        ).rejects.toMatchObject({ code: 'UNSUPPORTED_METRIC' })
        expect(execute).not.toHaveBeenCalled()
    })
})
