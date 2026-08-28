import { describe, expect, it, vi } from 'vitest'

import { createBrowserInsight } from '../src/integrations/browser/index.ts'

interface Events {
    setupCreated: Record<never, never>
    signup: { plan: string }
}

describe('createBrowserInsight', () => {
    it('sends bounded batches to the relay', async () => {
        const send = vi.fn<typeof fetch>().mockResolvedValue(new Response(null, { status: 204 }))
        const insight = createBrowserInsight<Events>({
            endpoint: '/events',
            fetch: send,
            maxBatchSize: 2,
        })

        insight.track('signup', { plan: 'free' })
        insight.track('signup', { plan: 'pro' })
        insight.track('signup', { plan: 'team' })
        await insight.flush()

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
        const insight = createBrowserInsight<Events>({ fetch: send })

        insight.track('signup', { plan: 'free' })
        await expect(insight.flush()).rejects.toThrow('503')
        await insight.flush()

        expect(send).toHaveBeenCalledTimes(2)
        expect(send.mock.calls[0]?.[1]?.body).toBe(send.mock.calls[1]?.[1]?.body)
    })

    it('best-effort flushes and allows events without properties', async () => {
        const send = vi.fn<typeof fetch>().mockResolvedValue(new Response(null, { status: 204 }))
        const insight = createBrowserInsight<Events>({ fetch: send })

        insight.track('setupCreated')
        await vi.waitFor(() => expect(send).toHaveBeenCalledOnce())

        expect(JSON.parse(requestBody(send, 0))).toEqual({
            events: [{ name: 'setupCreated', properties: {} }],
        })
    })

    it('rejects an invalid batch limit', () => {
        expect(() => createBrowserInsight({ maxBatchSize: 101 })).toThrow(RangeError)
    })
})

function requestBody(send: ReturnType<typeof vi.fn<typeof fetch>>, index: number): string {
    const body = send.mock.calls[index]?.[1]?.body
    if (typeof body !== 'string') throw new TypeError('Expected a string request body')
    return body
}
