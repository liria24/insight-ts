/* eslint-disable vitest/require-mock-type-parameters */

import { describe, expect, it, vi } from 'vitest'

import { createInsight, defineProvider } from '../src/core/index.ts'
import { defineLogAdapter, type LogRecord } from '../src/logs/index.ts'
import { defineMetricAdapter } from '../src/metrics/index.ts'
import { defineTraceAdapter } from '../src/traces/index.ts'

const time = { from: '2026-08-01', to: '2026-08-02' }

describe('per-result pagination', () => {
    it('continues a merged Log result without re-querying unrelated results', async () => {
        const metrics = vi.fn(() => ({ values: { requests: 42 } }))
        const firstLogs = vi.fn(({ nativeCursor }: { nativeCursor?: string }) =>
            nativeCursor
                ? { logs: [log('a0', 0)] }
                : { logs: [log('a4', 4), log('a2', 2)], nativeCursor: 'provider-a-page-2' },
        )
        const secondLogs = vi.fn(({ nativeCursor }: { nativeCursor?: string }) =>
            nativeCursor
                ? { logs: [log('b-1', -1)] }
                : { logs: [log('b3', 3), log('b1', 1)], nativeCursor: 'provider-b-page-2' },
        )
        const insight = createInsight({
            providers: [
                defineProvider({
                    adapters: {
                        metrics: defineMetricAdapter({
                            execute: metrics,
                            metrics: { requests: {} },
                        }),
                    },
                    id: 'metrics',
                }),
                defineProvider({
                    adapters: { logs: defineLogAdapter({ execute: firstLogs }) },
                    id: 'logs-a',
                }),
                defineProvider({
                    adapters: { logs: defineLogAdapter({ execute: secondLogs }) },
                    id: 'logs-b',
                }),
            ],
        })

        const first = await insight.query((q) => ({
            errors: q.logs({ limit: 2, time }),
            overview: q.metrics({ metrics: ['requests'], time }),
        }))
        const firstCursor = first.errors.meta.pagination?.next
        if (!firstCursor) throw new Error('Expected the first Log cursor')
        expect(first.errors.data.logs.map(({ id }) => id)).toEqual(['a4', 'b3'])
        expect(JSON.parse(JSON.stringify(first))).toEqual(first)
        expect(firstCursor).not.toContain('provider-a-page-2')

        const second = await insight.query((q) => ({
            errors: q.logs({ cursor: firstCursor, limit: 2, time }),
        }))
        const secondCursor = second.errors.meta.pagination?.next
        if (!secondCursor) throw new Error('Expected the second Log cursor')
        expect(second.errors.data.logs.map(({ id }) => id)).toEqual(['a2', 'b1'])
        expect(firstLogs).toHaveBeenLastCalledWith(
            expect.objectContaining({ nativeCursor: 'provider-a-page-2' }),
            expect.any(Object),
        )
        expect(secondLogs).toHaveBeenLastCalledWith(
            expect.objectContaining({ nativeCursor: 'provider-b-page-2' }),
            expect.any(Object),
        )

        const third = await insight.query((q) => ({
            errors: q.logs({ cursor: secondCursor, limit: 2, time }),
        }))
        expect(third.errors.data.logs.map(({ id }) => id)).toEqual(['a0', 'b-1'])
        expect(third.errors.meta.pagination).toBeUndefined()
        expect(metrics).toHaveBeenCalledOnce()
        expect(firstLogs).toHaveBeenCalledTimes(2)
        expect(secondLogs).toHaveBeenCalledTimes(2)
    })

    it('binds a cursor to the same logical query', async () => {
        const execute = vi.fn(() => ({
            logs: [log('a', 1), log('b', 0)],
            nativeCursor: 'next',
        }))
        const insight = createInsight({
            providers: [
                defineProvider({
                    adapters: { logs: defineLogAdapter({ execute }) },
                    id: 'logs',
                }),
            ],
        })
        const first = await insight.query((q) => ({ page: q.logs({ limit: 1, time }) }))
        const cursor = first.page.meta.pagination?.next
        if (!cursor) throw new Error('Expected a Log cursor')

        await expect(
            insight.query((q) => ({ page: q.logs({ cursor, limit: 2, time }) })),
        ).rejects.toMatchObject({ code: 'INVALID_QUERY' })
        expect(execute).toHaveBeenCalledOnce()
    })

    it('uses the same opaque continuation for Traces and buffer-only pages', async () => {
        const execute = vi.fn(({ nativeCursor }: { nativeCursor?: string }) =>
            nativeCursor
                ? { traces: [trace('t0', 0)] }
                : {
                      nativeCursor: 'trace-provider-next',
                      traces: [trace('t2', 2), trace('t1', 1)],
                  },
        )
        const insight = createInsight({
            providers: [
                defineProvider({
                    adapters: { traces: defineTraceAdapter({ execute }) },
                    id: 'traces',
                }),
            ],
        })
        const first = await insight.query((q) => ({ page: q.traces({ limit: 1, time }) }))
        const firstCursor = first.page.meta.pagination?.next
        if (!firstCursor) throw new Error('Expected the first Trace cursor')

        const second = await insight.query((q) => ({
            page: q.traces({ cursor: firstCursor, limit: 1, time }),
        }))
        const secondCursor = second.page.meta.pagination?.next
        if (!secondCursor) throw new Error('Expected the second Trace cursor')
        expect(second.page.data.traces.map(({ traceId }) => traceId)).toEqual(['t1'])
        expect(execute).toHaveBeenCalledOnce()

        const third = await insight.query((q) => ({
            page: q.traces({ cursor: secondCursor, limit: 1, time }),
        }))
        expect(third.page.data.traces.map(({ traceId }) => traceId)).toEqual(['t0'])
        expect(third.page.meta.pagination).toBeUndefined()
        expect(execute).toHaveBeenCalledTimes(2)
    })
})

const log = (id: string, minute: number): LogRecord => ({
    id,
    timestamp: new Date(Date.UTC(2026, 7, 1, 0, minute)).toISOString(),
})

const trace = (traceId: string, minute: number) => ({
    startTime: new Date(Date.UTC(2026, 7, 1, 0, minute)).toISOString(),
    traceId,
})
