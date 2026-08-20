import { describe, expect, it, vi } from 'vitest'

import { createBrowserAnalytics } from '../src/browser'

interface Events {
    setupCreated: Record<never, never>
    signup: { plan: string }
}

describe('createBrowserAnalytics', () => {
    it('sends bounded batches to the relay', async () => {
        const send = vi.fn<typeof fetch>().mockResolvedValue(new Response(null, { status: 204 }))
        const analytics = createBrowserAnalytics<Events>({
            endpoint: '/events',
            fetch: send,
            maxBatchSize: 2,
        })

        analytics.track('signup', { plan: 'free' })
        analytics.track('signup', { plan: 'pro' })
        analytics.track('signup', { plan: 'team' })
        await analytics.flush()

        expect(send).toHaveBeenCalledTimes(2)
        expect(JSON.parse(requestBody(send, 0))).toEqual({
            events: [
                { name: 'signup', properties: { plan: 'free' } },
                { name: 'signup', properties: { plan: 'pro' } },
            ],
        })
    })

    it('puts a failed batch back in the queue', async () => {
        const send = vi
            .fn<typeof fetch>()
            .mockResolvedValueOnce(new Response(null, { status: 503 }))
            .mockResolvedValueOnce(new Response(null, { status: 204 }))
        const analytics = createBrowserAnalytics<Events>({ fetch: send })

        analytics.track('signup', { plan: 'free' })
        await expect(analytics.flush()).rejects.toThrow('503')
        await analytics.flush()

        expect(send).toHaveBeenCalledTimes(2)
        expect(send.mock.calls[0]?.[1]?.body).toBe(send.mock.calls[1]?.[1]?.body)
    })

    it('best-effort flushes and allows events without properties', async () => {
        const send = vi.fn<typeof fetch>().mockResolvedValue(new Response(null, { status: 204 }))
        const analytics = createBrowserAnalytics<Events>({ fetch: send })

        analytics.track('setupCreated')
        await vi.waitFor(() => expect(send).toHaveBeenCalledOnce())

        expect(JSON.parse(requestBody(send, 0))).toEqual({
            events: [{ name: 'setupCreated', properties: {} }],
        })
    })

    it('rejects an invalid batch limit', () => {
        expect(() => createBrowserAnalytics({ maxBatchSize: 101 })).toThrow(RangeError)
    })
})

function requestBody(send: ReturnType<typeof vi.fn<typeof fetch>>, index: number): string {
    const body = send.mock.calls[index]?.[1]?.body
    if (typeof body !== 'string') throw new TypeError('Expected a string request body')
    return body
}
