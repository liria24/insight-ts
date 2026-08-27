import { describe, expect, it, vi } from 'vitest'

import { fetchWithRetry } from '../src/adapters/fetch-with-retry.ts'

type TestFetch = (input: RequestInfo | URL, init?: RequestInit) => Promise<Response>

describe('provider read retries', () => {
    it('retries a 503 and returns the successful response', async () => {
        const fetcher = vi
            .fn<TestFetch>()
            .mockResolvedValueOnce(new Response(null, { status: 503 }))
            .mockResolvedValueOnce(Response.json({ ok: true }))
        const sleep = vi.fn<(milliseconds: number) => Promise<void>>(async () => {})

        const response = await fetchWithRetry(fetcher, 'https://provider.test/read', undefined, {
            random: () => 0,
            sleep,
        })

        expect(await response.json()).toEqual({ ok: true })
        expect(fetcher).toHaveBeenCalledTimes(2)
        expect(sleep).toHaveBeenCalledWith(125)
    })

    it('respects Retry-After for 429 responses', async () => {
        const fetcher = vi
            .fn<TestFetch>()
            .mockResolvedValueOnce(
                new Response(null, { headers: { 'retry-after': '2' }, status: 429 }),
            )
            .mockResolvedValueOnce(Response.json({ ok: true }))
        const sleep = vi.fn<(milliseconds: number) => Promise<void>>(async () => {})

        await fetchWithRetry(fetcher, 'https://provider.test/read', undefined, { sleep })

        expect(fetcher).toHaveBeenCalledTimes(2)
        expect(sleep).toHaveBeenCalledWith(2000)
    })

    it('stops after two retries for continuous 503 responses', async () => {
        const fetcher = vi.fn<TestFetch>(async () => new Response(null, { status: 503 }))
        const sleep = vi.fn<(milliseconds: number) => Promise<void>>(async () => {})

        const response = await fetchWithRetry(fetcher, 'https://provider.test/read', undefined, {
            sleep,
        })

        expect(response.status).toBe(503)
        expect(fetcher).toHaveBeenCalledTimes(3)
        expect(sleep).toHaveBeenCalledTimes(2)
    })

    it.each([400, 401])('does not retry permanent %s responses', async (status) => {
        const fetcher = vi.fn<TestFetch>(async () => new Response(null, { status }))
        const sleep = vi.fn<(milliseconds: number) => Promise<void>>(async () => {})

        const response = await fetchWithRetry(fetcher, 'https://provider.test/read', undefined, {
            sleep,
        })

        expect(response.status).toBe(status)
        expect(fetcher).toHaveBeenCalledOnce()
        expect(sleep).not.toHaveBeenCalled()
    })
})
