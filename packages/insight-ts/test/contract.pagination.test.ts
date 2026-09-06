/* eslint-disable no-await-in-loop, vitest/require-mock-type-parameters */

import { describe, expect, it, vi } from 'vitest'

import { createInsight, defineProvider } from '../src/core/index.ts'
import { defineLogAdapter, type LogRecord } from '../src/logs/index.ts'
import { defineMetricAdapter } from '../src/metrics/index.ts'
import { defineTraceAdapter } from '../src/traces/index.ts'

const time = { from: '2026-08-01', to: '2026-08-02' }

describe('per-result pagination', () => {
    it('continues one serialized Log result without repeating its query', async () => {
        const metrics = vi.fn(() => ({ values: { requests: 42 } }))
        const logs = vi.fn(({ nativeCursor }: { nativeCursor?: string }) => {
            if (nativeCursor === 'provider-page-2') {
                return {
                    logs: [log('a2', 2), log('a1', 1)],
                    nativeCursor: 'provider-page-3',
                }
            }
            if (nativeCursor === 'provider-page-3') return { logs: [log('a0', 0)] }
            return {
                logs: [log('a4', 4), log('a3', 3)],
                nativeCursor: 'provider-page-2',
            }
        })
        const insight = createInsight({
            providers: [
                defineProvider({
                    adapters: {
                        metrics: defineMetricAdapter({
                            execute: metrics,
                            metrics: { requests: {} },
                        }),
                        logs: defineLogAdapter({ execute: logs }),
                    },
                    id: 'app',
                }),
            ],
        })

        const [first, overview] = await Promise.all([
            insight.logs({ limit: 2, time }),
            insight.metrics({ metrics: ['requests'], time }),
        ])
        // The assertion restores the known result type after the JSON boundary under test.
        // eslint-disable-next-line typescript/no-unsafe-type-assertion
        const restored = JSON.parse(JSON.stringify(first)) as typeof first
        const second = await insight.next(restored)
        const third = await insight.next(second)

        expect(first.logs.map(({ id }) => id)).toEqual(['a4', 'a3'])
        expect(second.logs.map(({ id }) => id)).toEqual(['a2', 'a1'])
        expect(third.logs.map(({ id }) => id)).toEqual(['a0'])
        expect(third.meta.pagination).toBeUndefined()
        expect(first.meta.pagination?.next).not.toContain('provider-page-2')
        expect(overview.aggregate.requests).toBe(42)
        expect(metrics).toHaveBeenCalledOnce()
        expect(logs).toHaveBeenCalledTimes(3)
        expect(logs).toHaveBeenNthCalledWith(
            2,
            expect.objectContaining({ limit: 2, nativeCursor: 'provider-page-2' }),
            expect.any(Object),
        )
    })

    it('rejects terminal results without issuing Provider I/O', async () => {
        const execute = vi.fn(() => ({ logs: [log('a', 1)] }))
        const insight = createInsight({
            providers: [
                defineProvider({
                    adapters: { logs: defineLogAdapter({ execute }) },
                    id: 'logs',
                }),
            ],
        })
        const result = await insight.logs({ limit: 1, time })

        await expect(insight.next(result)).rejects.toMatchObject({
            code: 'INVALID_QUERY',
            message: 'Query result has no continuation',
        })
        expect(execute).toHaveBeenCalledOnce()
    })

    it('binds continuation to its logical Scope and adapter configuration', async () => {
        const execute = vi.fn(({ nativeCursor }: { nativeCursor?: string }) => ({
            logs: [log(nativeCursor ? 'b' : 'a', nativeCursor ? 0 : 1)],
            ...(nativeCursor ? {} : { nativeCursor: 'next' }),
        }))
        const provider = defineProvider({
            adapters: { logs: defineLogAdapter({ execute }) },
            id: 'logs',
        })
        const insight = createInsight({ scopes: { production: [provider], staging: [provider] } })
        const production = insight.scope('production')
        const first = await production.logs({ limit: 1, time })

        await expect(insight.scope('staging').next(first)).rejects.toMatchObject({
            code: 'INVALID_QUERY',
        })
        const incompatibleExecute = vi.fn(() => ({ logs: [log('other', 0)] }))
        const incompatibleProvider = defineProvider({
            adapters: { logs: defineLogAdapter({ execute: incompatibleExecute }) },
            id: 'other',
        })
        const incompatible = createInsight({
            scopes: { production: [incompatibleProvider] },
        })
        await expect(incompatible.scope('production').next(first)).rejects.toMatchObject({
            code: 'INVALID_QUERY',
        })
        expect(incompatibleExecute).not.toHaveBeenCalled()

        await expect(production.next(first)).resolves.toMatchObject({
            logs: [{ id: 'b' }],
        })
        expect(execute).toHaveBeenCalledTimes(2)
    })

    it('rejects malformed, tampered, and oversized continuations before Provider I/O', async () => {
        const execute = vi.fn(() => ({
            logs: [log('a', 1)],
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
        const first = await insight.logs({ limit: 1, time })
        const cursor = first.meta.pagination!.next
        const position = Math.min(24, cursor.length - 1)
        const tampered = `${cursor.slice(0, position)}${cursor[position] === 'a' ? 'b' : 'a'}${cursor.slice(position + 1)}`

        for (const invalid of [
            'not-an-insight-continuation',
            'insight:v2:not-base64!',
            tampered,
            `insight:v2:${'a'.repeat(70_000)}`,
        ]) {
            await expect(
                insight.next({
                    ...first,
                    meta: { ...first.meta, pagination: { next: invalid } },
                }),
            ).rejects.toMatchObject({ code: 'INVALID_QUERY' })
        }
        expect(execute).toHaveBeenCalledOnce()
    })

    it('rejects repeated Provider cursors', async () => {
        const execute = vi.fn(() => ({ logs: [log(crypto.randomUUID(), 1)], nativeCursor: 'same' }))
        const insight = createInsight({
            providers: [
                defineProvider({
                    adapters: { logs: defineLogAdapter({ execute }) },
                    id: 'logs',
                }),
            ],
        })
        const first = await insight.logs({ limit: 1, time })

        await expect(insight.next(first)).rejects.toMatchObject({ code: 'INVALID_QUERY' })
        expect(execute).toHaveBeenCalledTimes(2)
    })

    it('uses the same result continuation shape for Traces', async () => {
        const execute = vi.fn(({ nativeCursor }: { nativeCursor?: string }) =>
            nativeCursor
                ? { traces: [trace('t1', 1)] }
                : { nativeCursor: 'trace-provider-next', traces: [trace('t2', 2)] },
        )
        const insight = createInsight({
            providers: [
                defineProvider({
                    adapters: { traces: defineTraceAdapter({ execute }) },
                    id: 'traces',
                }),
            ],
        })
        const first = await insight.traces({ limit: 1, time })
        // The assertion restores the known result type after the JSON boundary under test.
        // eslint-disable-next-line typescript/no-unsafe-type-assertion
        const restored = JSON.parse(JSON.stringify(first)) as typeof first

        await expect(insight.next(restored)).resolves.toMatchObject({
            meta: { queriedAt: expect.any(String) },
            traces: [{ traceId: 't1' }],
        })
        expect(execute).toHaveBeenCalledTimes(2)
    })

    it('keeps continuation size independent of result records', async () => {
        const body = 'record-body'.repeat(10_000)
        const insight = createInsight({
            providers: [
                defineProvider({
                    adapters: {
                        logs: defineLogAdapter({
                            execute: () => ({
                                logs: [{ ...log('a', 1), body }],
                                nativeCursor: 'next',
                            }),
                        }),
                    },
                    id: 'logs',
                }),
            ],
        })

        const first = await insight.logs({ limit: 1, time })

        expect(first.meta.pagination!.next.length).toBeLessThan(1000)
        expect(first.meta.pagination!.next).not.toContain(body)
    })

    it('fails explicitly when multi-adapter pagination would be required', async () => {
        const insight = createInsight({
            providers: [
                defineProvider({
                    adapters: {
                        logs: defineLogAdapter({
                            execute: () => ({ logs: [log('a', 1)], nativeCursor: 'next' }),
                        }),
                    },
                    id: 'first',
                }),
                defineProvider({
                    adapters: {
                        logs: defineLogAdapter({ execute: () => ({ logs: [log('b', 0)] }) }),
                    },
                    id: 'second',
                }),
            ],
        })

        await expect(insight.logs({ limit: 1, time })).rejects.toMatchObject({
            code: 'UNSUPPORTED_OPERATION',
        })
    })

    it('rejects adapter pages that exceed the requested limit', async () => {
        const insight = createInsight({
            providers: [
                defineProvider({
                    adapters: {
                        logs: defineLogAdapter({
                            execute: () => ({
                                logs: [log('a', 1), log('b', 0)],
                                nativeCursor: 'next',
                            }),
                        }),
                    },
                    id: 'logs',
                }),
            ],
        })

        await expect(insight.logs({ limit: 1, time })).rejects.toMatchObject({
            code: 'INVALID_QUERY',
        })
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
