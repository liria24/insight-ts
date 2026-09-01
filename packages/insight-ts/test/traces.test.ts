/* eslint-disable vitest/require-mock-type-parameters */

import { describe, expect, expectTypeOf, it, vi } from 'vitest'

import { createInsight, defineProvider } from '../src/core/index.ts'
import {
    defineTraceAdapter,
    type NormalizedTraceQuery,
    type TraceData,
} from '../src/traces/index.ts'

const time = { from: '2026-08-01', to: '2026-08-02' }

describe('canonical Traces', () => {
    it('normalizes portable filters and preserves span relationships', async () => {
        const first = vi.fn(() => ({
            quality: { partial: true },
            traces: [
                {
                    name: 'GET /checkout',
                    rootSpanId: 'root',
                    service: 'api',
                    spans: [
                        {
                            durationMs: 100,
                            id: 'root',
                            kind: 'server' as const,
                            name: 'GET /checkout',
                            startTime: '2026-08-01T03:00Z',
                            status: 'error' as const,
                            traceId: 'trace-new',
                        },
                        {
                            id: 'db',
                            name: 'postgres INSERT',
                            parentSpanId: 'root',
                            startTime: '2026-08-01T03:00:01Z',
                            traceId: 'trace-new',
                        },
                    ],
                    startTime: '2026-08-01T03:00Z',
                    status: 'error' as const,
                    traceId: 'trace-new',
                },
            ],
        }))
        const second = vi.fn(() => ({
            traces: [
                { startTime: '2026-08-01T03:00Z', traceId: 'trace-new' },
                { startTime: '2026-08-01T02:00Z', traceId: 'trace-old' },
            ],
        }))
        const options = {
            attributes: ['tenant'] as const,
            filters: ['durationMs', 'service', 'status', 'traceId'] as const,
        }
        const insight = createInsight({
            providers: [
                defineProvider({
                    adapters: { application: defineTraceAdapter({ ...options, execute: first }) },
                    id: 'application',
                }),
                defineProvider({
                    adapters: { edge: defineTraceAdapter({ ...options, execute: second }) },
                    id: 'edge',
                }),
            ],
        })

        const result = await insight.query((q) => ({
            failures: q.traces({
                time,
                where: {
                    attributes: { tenant: 'acme' },
                    durationMs: { gte: 50 },
                    service: 'api',
                    status: 'error',
                },
            }),
        }))

        expectTypeOf(result.failures.data).toEqualTypeOf<TraceData>()
        const expectedQuery: NormalizedTraceQuery = {
            time: {
                from: '2026-08-01T00:00:00.000Z',
                to: '2026-08-02T00:00:00.000Z',
            },
            where: [
                { field: 'attributes.tenant', operator: 'eq', value: 'acme' },
                { field: 'durationMs', operator: 'gte', value: 50 },
                { field: 'service', operator: 'eq', value: 'api' },
                { field: 'status', operator: 'eq', value: 'error' },
            ],
        }
        expect(first).toHaveBeenCalledWith(expectedQuery, expect.any(Object))
        expect(second).toHaveBeenCalledWith(expectedQuery, expect.any(Object))
        expect(result.failures.data.traces.map(({ traceId }) => traceId)).toEqual([
            'trace-new',
            'trace-old',
        ])
        const trace = result.failures.data.traces[0]
        expect(trace?.spanCount).toBe(2)
        expect(trace?.spans?.[1]).toMatchObject({ parentSpanId: 'root', traceId: 'trace-new' })
        expect(result.failures.meta.quality).toEqual({ partial: true })
    })

    it('uses the same stable result shape for trace detail by id', async () => {
        const insight = createInsight({
            providers: [
                defineProvider({
                    adapters: {
                        traces: defineTraceAdapter({
                            execute: ({ where }) => ({
                                traces: [
                                    {
                                        startTime: '2026-08-01',
                                        traceId: String(where?.[0]?.value),
                                    },
                                ],
                            }),
                            filters: ['traceId'],
                        }),
                    },
                    id: 'observability',
                }),
            ],
        })

        const { detail } = await insight.query((q) => ({
            detail: q.traces({ time, where: { traceId: 'trace-1' } }),
        }))

        expect(detail.data).toEqual({
            traces: [{ startTime: '2026-08-01T00:00:00.000Z', traceId: 'trace-1' }],
        })
    })

    it('rejects filters outside the adapter intersection before I/O', async () => {
        const execute = vi.fn(() => ({ traces: [] }))
        const insight = createInsight({
            providers: [
                defineProvider({
                    adapters: {
                        first: defineTraceAdapter({ execute, filters: ['durationMs'] }),
                    },
                    id: 'first',
                }),
                defineProvider({
                    adapters: { second: defineTraceAdapter({ execute }) },
                    id: 'second',
                }),
            ],
        })

        await expect(
            insight.query((q) => ({
                invalid: q.traces({ time, where: { durationMs: { gt: 10 } } }),
            })),
        ).rejects.toMatchObject({ code: 'UNSUPPORTED_OPERATION' })
        expect(execute).not.toHaveBeenCalled()
    })
})
