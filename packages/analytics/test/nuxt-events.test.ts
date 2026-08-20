import { createApp, toWebHandler } from 'h3'
import { describe, expect, it, vi } from 'vitest'

import { createAnalyticsEventHandler, type AnalyticsEventHandlerOptions } from '../src/nuxt'

const definitions = {
    signup: {
        properties: {
            plan: ['free', 'pro'],
        },
    },
} as const

describe('Nuxt analytics event relay', () => {
    it('validates and adds server-owned fields before one batch delivery', async () => {
        const deliver = vi.fn<AnalyticsEventHandlerOptions['deliver']>(async () => {})
        const app = createApp()
        app.use(
            createAnalyticsEventHandler({
                deliver,
                events: definitions,
                id: () => 'evt_1',
                now: () => new Date('2026-08-20T00:00:00.000Z'),
            }),
        )

        const response = await toWebHandler(app)(
            request({ events: [{ name: 'signup', properties: { plan: 'pro' } }] }),
        )

        expect(response.status).toBe(200)
        expect(deliver).toHaveBeenCalledOnce()
        expect(deliver).toHaveBeenCalledWith(
            [
                {
                    id: 'evt_1',
                    name: 'signup',
                    origin: 'client',
                    properties: { plan: 'pro' },
                    timestamp: '2026-08-20T00:00:00.000Z',
                },
            ],
            expect.anything(),
        )
    })

    it('rejects unknown events and client-supplied system fields', async () => {
        const app = createApp()
        app.use(createAnalyticsEventHandler({ deliver: async () => {}, events: definitions }))
        const send = toWebHandler(app)

        const unknown = await send(request({ events: [{ name: 'purchase', properties: {} }] }))
        const inherited = await send(request({ events: [{ name: 'toString', properties: {} }] }))
        const spoofed = await send(
            request({
                events: [
                    {
                        name: 'signup',
                        properties: { plan: 'free' },
                        source: 'server',
                    },
                ],
            }),
        )

        expect(unknown.status).toBe(400)
        expect(inherited.status).toBe(400)
        expect(spoofed.status).toBe(400)
    })

    it('stops reading a chunked body at the configured limit', async () => {
        const app = createApp()
        app.use(
            createAnalyticsEventHandler({
                deliver: async () => {},
                events: definitions,
                maxBodySize: 32,
            }),
        )

        const response = await toWebHandler(app)(
            request({ events: [{ name: 'signup', properties: { plan: 'free'.repeat(20) } }] }),
        )

        expect(response.status).toBe(413)
    })

    it('rejects cross-origin requests', async () => {
        const app = createApp()
        app.use(createAnalyticsEventHandler({ deliver: async () => {}, events: definitions }))

        const response = await toWebHandler(app)(
            request(
                { events: [{ name: 'signup', properties: { plan: 'free' } }] },
                'https://other.test',
            ),
        )

        expect(response.status).toBe(403)
    })
})

function request(body: unknown, origin = 'http://localhost'): Request {
    return new Request('http://example.test/api/analytics/events', {
        body: JSON.stringify(body),
        headers: {
            'content-type': 'application/json',
            origin,
        },
        method: 'POST',
    })
}
