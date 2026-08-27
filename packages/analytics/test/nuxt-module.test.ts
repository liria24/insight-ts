import { mkdtemp, rm, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'

import { describe, expect, it } from 'vitest'

import {
    createServerRuntimeTemplate,
    createVueStyleTemplate,
    missingProviderWarnings,
    resolveArchiveBase,
    sourceUsesAnalyticsVueComponents,
} from '../src/integrations/nuxt/module'

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
                googleSearchConsole: 'sc-domain:example.com',
            },
        })

        expect(template).toContain('process.env.CLOUDFLARE_API_TOKEN')
        expect(template).toContain('event.context.cloudflare?.env?.["ANALYTICS"]')
        expect(template).toContain('siteTag: "site-tag"')
        expect(template).toContain('property: "sc-domain:example.com"')
        expect(template).toContain('events: {"pageViewed":{"properties":{"path":"string"}}}')
        expect(template).toContain('config.providers?.googleSearchConsole?.getAccessToken')
        expect(template).toContain('state: config.state')
        expect(template).toContain("from '#imports'")
        expect(template).toContain("import config from '#analytics/server-config'")
        expect(template).toContain('event?.context.cloudflare?.env?.["ANALYTICS"]')
        expect(template).toContain('eventDestination')
        expect(template).not.toContain('apiToken: "')
        expect(template).not.toContain('config.config')
        expect(template).not.toContain('config.getAccessToken')
    })

    it('passes a configured Web Analytics host to the runtime adapter', () => {
        const template = createServerRuntimeTemplate({
            name: 'website',
            providers: {
                cloudflare: {
                    webAnalytics: {
                        host: 'analytics.liria.me',
                        siteTag: 'site-tag',
                    },
                },
            },
        })

        expect(template).toContain('siteTag: "site-tag", host: "analytics.liria.me"')
    })

    it('resolves request-scoped custom Providers without caching the client', () => {
        const template = createServerRuntimeTemplate({ name: 'website' })

        expect(template).toContain("typeof config.customProviders === 'function'")
        expect(template).toContain('await config.customProviders({ event })')
        expect(template).toContain('return createServerAnalytics(event)')
    })

    it('omits provider imports and warns when configured identifiers are missing', () => {
        const options = {
            name: 'website',
            providers: {
                cloudflare: {
                    analyticsEngine: {},
                    r2: {},
                    webAnalytics: {},
                },
                googleSearchConsole: {},
            },
        }
        const template = createServerRuntimeTemplate(options)

        expect(missingProviderWarnings(options)).toHaveLength(4)
        expect(template).not.toContain('@liria24/analytics/cloudflare')
        expect(template).not.toContain('@liria24/analytics/google-search-console')
        expect(template).not.toContain("from '#imports'")
    })

    it('disables only a provider whose runtime credentials are missing', () => {
        const template = createServerRuntimeTemplate({
            name: 'website',
            providers: { cloudflare: { webAnalytics: 'site-tag' } },
        })

        expect(template).toContain("import { cloudflare } from '@liria24/analytics/cloudflare'")
        expect(template).not.toContain('googleSearchConsole')
        expect(template).toContain('Cloudflare Web Analytics is unavailable because')
        expect(template).not.toContain('Cloudflare Web Analytics credentials are missing')
    })

    it('resolves the archive mount before applying an R2 binding', () => {
        expect(resolveArchiveBase({ name: 'r2', providers: { cloudflare: { r2: 'R2' } } })).toBe(
            'analytics:archive',
        )
        expect(resolveArchiveBase({ archive: { base: 'my-archive' }, name: 'archive' })).toBe(
            'my-archive',
        )
        expect(
            resolveArchiveBase({
                archive: { base: 'my-archive' },
                name: 'r2-custom',
                providers: { cloudflare: { r2: 'R2' } },
            }),
        ).toBe('my-archive')
    })

    it('detects component usage without treating composable-only imports as UI', () => {
        expect(
            sourceUsesAnalyticsVueComponents(
                "import { AnalyticsStat as Stat } from '@liria24/analytics/vue'",
            ),
        ).toBe(true)
        expect(
            sourceUsesAnalyticsVueComponents(
                "import * as AnalyticsUI from '@liria24/analytics/vue'",
            ),
        ).toBe(true)
        expect(
            sourceUsesAnalyticsVueComponents(
                "import { provideAnalytics, useAnalytics } from '@liria24/analytics/vue'",
            ),
        ).toBe(false)
    })

    it('regenerates auto style content when component source is added or removed', async () => {
        const directory = await mkdtemp(join(tmpdir(), 'analytics-vue-detection-'))
        const component = join(directory, 'app.vue')
        try {
            await writeFile(
                component,
                "<script setup>import { provideAnalytics } from '@liria24/analytics/vue'</script>",
            )
            expect(createVueStyleTemplate('auto', directory)).toBe('/* empty */\n')

            await writeFile(
                component,
                '<template><AnalyticsLineChart :report="report" /></template>',
            )
            expect(createVueStyleTemplate('auto', directory)).toContain(
                '@liria24/analytics/vue/style.css',
            )

            await rm(component)
            expect(createVueStyleTemplate('auto', directory)).toBe('/* empty */\n')
            expect(createVueStyleTemplate(true, directory)).toContain(
                '@liria24/analytics/vue/style.css',
            )
        } finally {
            await rm(directory, { force: true, recursive: true })
        }
    })
})
