import { describe, expect, it, vi } from 'vitest'

import { fetchWithRetry } from '../src/providers/shared/fetch-with-retry.ts'

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

    it('bounds excessive Retry-After delays', async () => {
        const fetcher = vi
            .fn<TestFetch>()
            .mockResolvedValueOnce(
                new Response(null, { headers: { 'retry-after': '3600' }, status: 429 }),
            )
            .mockResolvedValueOnce(Response.json({ ok: true }))
        const sleep = vi.fn<(milliseconds: number) => Promise<void>>(async () => {})

        await fetchWithRetry(fetcher, 'https://provider.test/read', undefined, { sleep })

        expect(sleep).toHaveBeenCalledWith(30_000)
    })

    it('aborts during backoff without another attempt', async () => {
        const controller = new AbortController()
        const reason = new Error('cancel retry')
        const fetcher = vi.fn<TestFetch>(async () => new Response(null, { status: 503 }))

        const response = fetchWithRetry(
            fetcher,
            'https://provider.test/read',
            { signal: controller.signal },
            { random: () => 0 },
        )
        await new Promise((resolve) => setTimeout(resolve, 0))
        controller.abort(reason)

        await expect(response).rejects.toBe(reason)
        expect(fetcher).toHaveBeenCalledOnce()
    })

    it('retries fetch network failures but not application exceptions', async () => {
        const fetcher = vi
            .fn<TestFetch>()
            .mockRejectedValueOnce(new TypeError('network unavailable'))
            .mockResolvedValueOnce(Response.json({ ok: true }))
        const sleep = vi.fn<(milliseconds: number) => Promise<void>>(async () => {})

        const response = await fetchWithRetry(fetcher, 'https://provider.test/read', undefined, {
            random: () => 0,
            sleep,
        })
        const applicationError = new Error('application failure')
        const applicationFetcher = vi.fn<TestFetch>(async () => {
            throw applicationError
        })

        expect(await response.json()).toEqual({ ok: true })
        expect(fetcher).toHaveBeenCalledTimes(2)
        expect(sleep).toHaveBeenCalledWith(125)
        await expect(
            fetchWithRetry(applicationFetcher, 'https://provider.test/read', undefined, { sleep }),
        ).rejects.toBe(applicationError)
        expect(applicationFetcher).toHaveBeenCalledOnce()
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
