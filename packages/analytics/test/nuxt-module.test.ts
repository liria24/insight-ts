import { describe, expect, it } from 'vitest'

import { createServerRuntimeTemplate } from '../src/integrations/nuxt/module'

describe('Nuxt module templates', () => {
    it('serializes resource identifiers but resolves credentials at runtime', () => {
        const template = createServerRuntimeTemplate({
            events: { pageViewed: { properties: { path: 'string' } } },
            name: 'website',
            providers: {
                cloudflare: {
                    analyticsEngine: 'ANALYTICS',
                    webAnalytics: 'site-tag',
                },
                searchConsole: 'sc-domain:example.com',
            },
        })

        expect(template).toContain('process.env.CLOUDFLARE_API_TOKEN')
        expect(template).toContain('event.context.cloudflare?.env?.["ANALYTICS"]')
        expect(template).toContain('siteTag: "site-tag"')
        expect(template).toContain('property: "sc-domain:example.com"')
        expect(template).toContain('events: {"pageViewed":{"properties":{"path":"string"}}}')
        expect(template).toContain('event?.context.cloudflare?.env?.["ANALYTICS"]')
        expect(template).toContain('eventSink')
        expect(template).not.toContain('apiToken: "')
    })
})
