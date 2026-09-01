/* eslint-disable vitest/require-mock-type-parameters */

import { describe, expect, it, vi } from 'vitest'

import { createInsight, defineProvider, type EventDestination } from '../src/core/index.ts'

describe('Track contract', () => {
    it('rejects unknown events, missing or extra properties, and invalid values', async () => {
        const destination = vi.fn<EventDestination['track']>()
        const insight = createInsight({
            events: {
                search: { properties: { count: 'number', kind: ['docs', 'api'] } },
            },
            providers: [defineProvider({ events: { track: destination }, id: 'events' })],
        })
        await expect(
            // @ts-expect-error runtime contract rejects invalid JavaScript callers
            insight.track('unknown'),
        ).rejects.toMatchObject({ code: 'INVALID_QUERY' })
        await expect(
            // @ts-expect-error required properties are deliberately omitted
            insight.track('search', { count: 1 }),
        ).rejects.toMatchObject({
            code: 'INVALID_QUERY',
        })
        await expect(
            // @ts-expect-error extra properties are deliberately supplied
            insight.track('search', { count: 1, extra: true, kind: 'docs' }),
        ).rejects.toMatchObject({ code: 'INVALID_QUERY' })
        await expect(
            insight.track('search', { count: Number.NaN, kind: 'docs' }),
        ).rejects.toMatchObject({ code: 'INVALID_QUERY' })
        await expect(
            // @ts-expect-error enum value is deliberately invalid
            insight.track('search', { count: 1, kind: 'other' }),
        ).rejects.toMatchObject({ code: 'INVALID_QUERY' })
        expect(destination).not.toHaveBeenCalled()
    })

    it('routes one server-owned event to every destination in the selected Scope', async () => {
        const first = vi.fn<EventDestination['track']>()
        const second = vi.fn<EventDestination['track']>()
        const staging = vi.fn<EventDestination['track']>()
        const insight = createInsight({
            events: { deploy: { properties: { version: 'string' } } },
            now: () => new Date('2026-08-01T00:00:00.000Z'),
            scopes: {
                production: [
                    defineProvider({ events: { track: first }, id: 'first' }),
                    defineProvider({ events: { track: second }, id: 'second' }),
                ],
                staging: [defineProvider({ events: { track: staging }, id: 'staging' })],
            },
        })

        await insight.scope('production').track('deploy', { version: '1.0.0' })

        expect(first).toHaveBeenCalledOnce()
        expect(second).toHaveBeenCalledOnce()
        expect(staging).not.toHaveBeenCalled()
        expect(first.mock.calls[0]?.[0]).toBe(second.mock.calls[0]?.[0])
        expect(first.mock.calls[0]?.[0]).toMatchObject({
            id: expect.any(String),
            name: 'deploy',
            origin: 'server',
            properties: { version: '1.0.0' },
            timestamp: '2026-08-01T00:00:00.000Z',
        })
    })

    it('reports destination failure after attempting every configured destination', async () => {
        const failure = new Error('destination unavailable')
        const failed = vi.fn<EventDestination['track']>(async () => Promise.reject(failure))
        const delivered = vi.fn<EventDestination['track']>()
        const insight = createInsight({
            events: { ping: {} },
            providers: [
                defineProvider({ events: { track: failed }, id: 'failed' }),
                defineProvider({ events: { track: delivered }, id: 'delivered' }),
            ],
        })

        await expect(insight.track('ping')).rejects.toBe(failure)
        expect(failed).toHaveBeenCalledOnce()
        expect(delivered).toHaveBeenCalledOnce()
    })
})
