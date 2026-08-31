/* eslint-disable vitest/require-mock-type-parameters */

import { describe, expect, expectTypeOf, it, vi } from 'vitest'

import { createInsight, defineProvider } from '../src/core/index.ts'
import { defineLogAdapter, type LogData, type NormalizedLogQuery } from '../src/logs/index.ts'

const time = { from: '2026-08-01', to: '2026-08-02' }

describe('canonical Logs', () => {
    it('normalizes filters and merges adapters by stable id and timestamp', async () => {
        const first = vi.fn(() => ({
            logs: [
                {
                    body: 'older',
                    id: 'a',
                    severity: 'info' as const,
                    timestamp: '2026-08-01T01:00Z',
                },
                {
                    attributes: { request: { cached: false, size: 42 } },
                    body: { message: 'structured', retry: false },
                    id: 'shared',
                    severity: 'error' as const,
                    timestamp: '2026-08-01T03:00Z',
                    traceId: 'trace-1',
                },
            ],
            quality: { sampled: true, sampleRate: 0.5 },
        }))
        const second = vi.fn(() => ({
            logs: [
                { body: 'duplicate', id: 'shared', timestamp: '2026-08-01T03:00Z' },
                { body: 'middle', id: 'b', timestamp: '2026-08-01T02:00Z' },
            ],
        }))
        const options = {
            attributes: ['tenant'] as const,
            filters: ['severity'] as const,
        }
        const insight = createInsight({
            now: () => new Date('2026-08-02T00:00Z'),
            providers: [
                defineProvider({
                    adapters: { application: defineLogAdapter({ ...options, execute: first }) },
                    id: 'application',
                }),
                defineProvider({
                    adapters: { edge: defineLogAdapter({ ...options, execute: second }) },
                    id: 'edge',
                }),
            ],
        })

        const result = await insight.query((q) => ({
            recent: q.logs({
                limit: 3,
                time,
                where: { attributes: { tenant: 'acme' }, severity: { in: ['error'] } },
            }),
        }))

        expectTypeOf(result.recent.data).toEqualTypeOf<LogData>()
        const expectedQuery: NormalizedLogQuery = {
            limit: 3,
            time: {
                from: '2026-08-01T00:00:00.000Z',
                to: '2026-08-02T00:00:00.000Z',
            },
            where: [
                { field: 'attributes.tenant', operator: 'eq', value: 'acme' },
                { field: 'severity', operator: 'in', value: ['error'] },
            ],
        }
        expect(first).toHaveBeenCalledWith(expectedQuery, expect.any(Object))
        expect(second).toHaveBeenCalledWith(expectedQuery, expect.any(Object))
        expect(result.recent.data.logs.map(({ id }) => id)).toEqual(['shared', 'b', 'a'])
        expect(result.recent.data.logs[0]?.body).toEqual({ message: 'structured', retry: false })
        expect(result.recent.meta.quality).toEqual({ sampled: true, sampleRate: 0.5 })
        expect(result.recent.meta.contributions).toHaveLength(2)
    })

    it('rejects filters outside the adapter intersection before I/O', async () => {
        const execute = vi.fn(() => ({ logs: [] }))
        const insight = createInsight({
            providers: [
                defineProvider({
                    adapters: {
                        first: defineLogAdapter({ execute, filters: ['service'] }),
                    },
                    id: 'first',
                }),
                defineProvider({
                    adapters: { second: defineLogAdapter({ execute }) },
                    id: 'second',
                }),
            ],
        })

        await expect(
            insight.query((q) => ({
                invalid: q.logs({ time, where: { service: 'api' } }),
            })),
        ).rejects.toMatchObject({ code: 'UNSUPPORTED_OPERATION' })
        expect(execute).not.toHaveBeenCalled()
    })

    it('rejects records without a stable id', async () => {
        const insight = createInsight({
            providers: [
                defineProvider({
                    adapters: {
                        logs: defineLogAdapter({
                            execute: () => ({
                                logs: [{ id: '', timestamp: '2026-08-01T00:00Z' }],
                            }),
                        }),
                    },
                    id: 'broken',
                }),
            ],
        })

        await expect(insight.query((q) => ({ recent: q.logs({ time }) }))).rejects.toMatchObject({
            code: 'INVALID_QUERY',
        })
    })
})
