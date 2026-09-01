import { describe, expect, it, vi } from 'vitest'

import {
    createBrowserInsight,
    type BrowserInsightErrorContext,
} from '../src/integrations/browser/index.ts'

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

    it('retries transient failures without changing batch order', async () => {
        const send = vi
            .fn<typeof fetch>()
            .mockResolvedValueOnce(new Response(null, { status: 503 }))
            .mockResolvedValueOnce(new Response(null, { status: 204 }))
        const insight = createBrowserInsight<Events>({ fetch: send, retryDelayMs: 0 })

        insight.track('signup', { plan: 'free' })
        await insight.flush()

        expect(send).toHaveBeenCalledTimes(2)
        expect(send.mock.calls[0]?.[1]?.body).toBe(send.mock.calls[1]?.[1]?.body)
    })

    it('flushes on the configured timer and allows events without properties', async () => {
        vi.useFakeTimers()
        const send = vi.fn<typeof fetch>().mockResolvedValue(new Response(null, { status: 204 }))
        const insight = createBrowserInsight<Events>({ fetch: send, flushIntervalMs: 25 })

        insight.track('setupCreated')
        await vi.advanceTimersByTimeAsync(24)
        expect(send).not.toHaveBeenCalled()
        await vi.advanceTimersByTimeAsync(1)
        await insight.flush()

        expect(JSON.parse(requestBody(send, 0))).toEqual({
            events: [{ name: 'setupCreated', properties: {} }],
        })
        vi.useRealTimers()
    })

    it('flushes immediately at byte limits and bounds queue overflow', async () => {
        const send = vi.fn<typeof fetch>().mockResolvedValue(new Response(null, { status: 204 }))
        const onError = vi.fn<(error: unknown, context: BrowserInsightErrorContext) => void>()
        const event = { name: 'signup', properties: { plan: 'free' } }
        const twoEventBytes = new TextEncoder().encode(
            JSON.stringify({ events: [event, event] }),
        ).byteLength
        const insight = createBrowserInsight<Events>({
            fetch: send,
            flushIntervalMs: 10_000,
            maxBatchBytes: twoEventBytes,
            maxQueueSize: 2,
            onError,
        })

        insight.track('signup', { plan: 'free' })
        insight.track('signup', { plan: 'free' })
        insight.track('signup', { plan: 'dropped' })
        await insight.flush()

        expect(send).toHaveBeenCalledOnce()
        expect(JSON.parse(requestBody(send, 0)).events).toHaveLength(2)
        expect(onError).toHaveBeenCalledWith(expect.any(RangeError), {
            dropped: 1,
            reason: 'queue-overflow',
            retries: 0,
        })
    })

    it('drops exhausted batches observably and continues in order', async () => {
        const send = vi
            .fn<typeof fetch>()
            .mockResolvedValueOnce(new Response(null, { status: 503 }))
            .mockResolvedValueOnce(new Response(null, { status: 503 }))
            .mockResolvedValueOnce(new Response(null, { status: 204 }))
        const onError = vi.fn<(error: unknown, context: BrowserInsightErrorContext) => void>()
        const insight = createBrowserInsight<Events>({
            fetch: send,
            maxBatchSize: 1,
            maxRetries: 1,
            onError,
            retryDelayMs: 0,
        })

        insight.track('signup', { plan: 'first' })
        insight.track('signup', { plan: 'second' })
        await expect(insight.flush()).rejects.toThrow('503')

        expect(requestBody(send, 0)).toBe(requestBody(send, 1))
        expect(JSON.parse(requestBody(send, 2)).events[0].properties.plan).toBe('second')
        expect(onError).toHaveBeenCalledWith(expect.any(Error), {
            dropped: 1,
            reason: 'send',
            retries: 1,
        })
    })

    it('reports oversized events and flushes on pagehide with keepalive', async () => {
        const addEventListener = vi.fn<(name: string, listener: () => void) => void>()
        vi.stubGlobal('addEventListener', addEventListener)
        const send = vi.fn<typeof fetch>().mockResolvedValue(new Response(null, { status: 204 }))
        const onError = vi.fn<(error: unknown, context: BrowserInsightErrorContext) => void>()
        const insight = createBrowserInsight<Events>({
            fetch: send,
            flushIntervalMs: 10_000,
            maxBatchBytes: 60,
            onError,
        })

        insight.track('signup', { plan: 'x'.repeat(100) })
        expect(onError).toHaveBeenCalledWith(expect.any(RangeError), {
            dropped: 1,
            reason: 'event-too-large',
            retries: 0,
        })
        insight.track('setupCreated')
        const pagehide = addEventListener.mock.calls.find(([name]) => name === 'pagehide')?.[1]
        if (!pagehide) throw new TypeError('Missing pagehide listener')
        pagehide()
        await vi.waitFor(() => expect(send).toHaveBeenCalledOnce())
        expect(send.mock.calls[0]?.[1]?.keepalive).toBe(true)
        vi.unstubAllGlobals()
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
