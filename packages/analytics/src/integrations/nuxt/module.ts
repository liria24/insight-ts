import { existsSync } from 'node:fs'
import { join } from 'node:path'
import { pathToFileURL } from 'node:url'

import {
    addImports,
    addServerHandler,
    addServerImports,
    addServerTemplate,
    addTemplate,
    addTypeTemplate,
    defineNuxtModule,
    useLogger,
} from 'nuxt/kit'
import type { NuxtModule } from 'nuxt/schema'

import { configureMaintenanceTask, configureR2Storage, requireStorageMount } from './nitro'
import type { NuxtAnalyticsModuleOptions, NuxtAnalyticsRelayOptions } from './types'

const module: NuxtModule<NuxtAnalyticsModuleOptions> = defineNuxtModule<NuxtAnalyticsModuleOptions>(
    {
        meta: {
            compatibility: { nuxt: '>=4.5.1' },
            configKey: 'analytics',
            name: '@liria24/analytics',
        },
        setup(options, nuxt) {
            if (!options.name) throw new TypeError('analytics.name is required')
            const logger = useLogger('@liria24/analytics')
            for (const warning of missingProviderWarnings(options)) logger.warn(warning)

            const events = options.events ?? {}
            const r2 = options.providers?.cloudflare?.r2
            const r2BindingValue = typeof r2 === 'string' ? r2 : r2?.binding
            const r2Binding = r2BindingValue?.trim() || undefined
            const archiveEnabled = Boolean(options.archive || r2Binding)
            const archiveBase = resolveArchiveBase(options)
            if (archiveBase.length === 0) {
                throw new TypeError('analytics.archive.base cannot be empty')
            }
            const relayEnabled = options.relay === true || typeof options.relay === 'object'
            if (relayEnabled && Object.keys(events).length === 0) {
                throw new TypeError('analytics.relay requires at least one analytics.events entry')
            }
            const relayOptions = typeof options.relay === 'object' ? options.relay : {}
            const relay = {
                maxBatchSize: relayOptions.maxBatchSize ?? 20,
                maxBodySize: relayOptions.maxBodySize ?? 64 * 1024,
                route: relayOptions.route ?? '/api/_analytics/events',
            }
            const userConfigPath = join(nuxt.options.srcDir, 'server', 'analytics.config.ts')
            const getServerConfig = () => createServerConfigTemplate(userConfigPath)
            addTemplate({
                filename: 'analytics/server-config.mjs',
                getContents: getServerConfig,
                write: true,
            })
            addServerTemplate({
                filename: '#analytics/server-config',
                getContents: getServerConfig,
            })

            const getServerRuntime = () => createServerRuntimeTemplate(options)
            addTemplate({
                filename: 'analytics/server.mjs',
                getContents: getServerRuntime,
                write: true,
            })
            addServerTemplate({ filename: '#analytics/server', getContents: getServerRuntime })
            const serverRuntimeTypes = addTypeTemplate(
                {
                    filename: 'analytics/server-runtime.d.ts',
                    getContents: createServerRuntimeTypeTemplate,
                },
                { nitro: true },
            )
            addServerImports([
                {
                    from: '#analytics/server',
                    name: 'deliverEvents',
                    typeFrom: serverRuntimeTypes.dst,
                },
                {
                    from: '#analytics/server',
                    name: 'useServerAnalytics',
                    typeFrom: serverRuntimeTypes.dst,
                },
            ])

            if (relayEnabled) {
                const browserRuntime = addTemplate({
                    filename: 'analytics/browser.ts',
                    getContents: () => createBrowserRuntimeTemplate(events, relay),
                    write: true,
                })
                addImports({ from: browserRuntime.dst, name: 'useAnalytics' })

                const handler = addTemplate({
                    filename: 'analytics/events.mjs',
                    getContents: () => createEventHandlerTemplate(events, relay),
                    write: true,
                })
                addServerHandler({ handler: handler.dst, method: 'post', route: relay.route })
            }

            if (archiveEnabled) {
                const maintenance = addTemplate({
                    filename: 'analytics/maintenance.mjs',
                    getContents: () => maintenanceTaskTemplate,
                    write: true,
                })
                nuxt.hook('nitro:config', (nitroConfig) => {
                    if (r2Binding) {
                        configureR2Storage(nitroConfig, archiveBase, r2Binding)
                    }
                    requireStorageMount(nitroConfig, archiveBase)
                    configureMaintenanceTask(nitroConfig, maintenance.dst)
                })
            }
        },
    },
)

export default module

function createServerConfigTemplate(userConfigPath: string): string {
    const userConfigImport = existsSync(userConfigPath)
        ? `import userConfig from ${JSON.stringify(pathToFileURL(userConfigPath).href)}`
        : 'const userConfig = {}'
    return `${userConfigImport}
const config = typeof userConfig === 'function' ? await userConfig() : userConfig
export default config
`
}

export function resolveArchiveBase(options: NuxtAnalyticsModuleOptions): string {
    return typeof options.archive === 'object'
        ? (options.archive.base ?? 'analytics:archive')
        : 'analytics:archive'
}

export function missingProviderWarnings(options: NuxtAnalyticsModuleOptions): string[] {
    const warnings: string[] = []
    const cloudflare = options.providers?.cloudflare
    const webAnalytics = cloudflare?.webAnalytics
    const siteTag = typeof webAnalytics === 'string' ? webAnalytics : webAnalytics?.siteTag
    const analyticsEngine = cloudflare?.analyticsEngine
    const analyticsEngineBinding =
        typeof analyticsEngine === 'string' ? analyticsEngine : analyticsEngine?.binding
    const r2 = cloudflare?.r2
    const r2Binding = typeof r2 === 'string' ? r2 : r2?.binding
    const searchConsole = options.providers?.googleSearchConsole
    const searchProperty =
        typeof searchConsole === 'string' ? searchConsole : searchConsole?.property

    if (webAnalytics !== undefined && !siteTag?.trim()) {
        warnings.push(
            'Cloudflare Web Analytics is disabled because analytics.providers.cloudflare.webAnalytics.siteTag is missing',
        )
    }
    if (analyticsEngine !== undefined && !analyticsEngineBinding?.trim()) {
        warnings.push(
            'Cloudflare Analytics Engine is disabled because analytics.providers.cloudflare.analyticsEngine.binding is missing',
        )
    }
    if (r2 !== undefined && !r2Binding?.trim()) {
        warnings.push(
            'Cloudflare R2 archive storage is disabled because analytics.providers.cloudflare.r2.binding is missing',
        )
    }
    if (searchConsole !== undefined && !searchProperty?.trim()) {
        warnings.push(
            'Google Search Console is disabled because analytics.providers.googleSearchConsole.property is missing',
        )
    }
    return warnings
}

function createServerRuntimeTypeTemplate(): string {
    return `import type { NuxtAnalyticsServerRuntime } from '@liria24/analytics/nuxt/runtime'

export declare const deliverEvents: NuxtAnalyticsServerRuntime['deliverEvents']
export declare const useServerAnalytics: NuxtAnalyticsServerRuntime['useServerAnalytics']
`
}

export function createServerRuntimeTemplate(options: NuxtAnalyticsModuleOptions): string {
    const archive = typeof options.archive === 'object' ? options.archive : {}
    const r2 = options.providers?.cloudflare?.r2
    const r2BindingValue = typeof r2 === 'string' ? r2 : r2?.binding
    const r2Binding = r2BindingValue?.trim() || undefined
    const archiveEnabled = Boolean(options.archive || r2Binding)
    const archiveBase = resolveArchiveBase(options)
    const archiveExpression = archiveEnabled
        ? `{ storage: useStorage(${JSON.stringify(archiveBase)}), ${
              archive.retention ? `retention: ${JSON.stringify(archive.retention)}` : ''
          } }`
        : 'undefined'

    const webAnalytics = options.providers?.cloudflare?.webAnalytics
    const siteTagValue = typeof webAnalytics === 'string' ? webAnalytics : webAnalytics?.siteTag
    const siteTag = siteTagValue?.trim() || undefined
    const host = typeof webAnalytics === 'string' ? undefined : webAnalytics?.host
    const searchConsole = options.providers?.googleSearchConsole
    const searchPropertyValue =
        typeof searchConsole === 'string' ? searchConsole : searchConsole?.property
    const searchProperty = searchPropertyValue?.trim() || undefined
    const analyticsEngine = options.providers?.cloudflare?.analyticsEngine
    const analyticsEngineBindingValue =
        typeof analyticsEngine === 'string' ? analyticsEngine : analyticsEngine?.binding
    const analyticsEngineBinding = analyticsEngineBindingValue?.trim() || undefined
    const cloudflareImports = [
        ...(siteTag || analyticsEngineBinding ? ['cloudflare'] : []),
        ...(analyticsEngineBinding ? ['cloudflareAnalyticsEngine'] : []),
    ]
    const nuxtImports = [
        ...(siteTag ? ['useRuntimeConfig'] : []),
        ...(archiveEnabled ? ['useStorage'] : []),
    ]

    return `import { createAnalytics } from '@liria24/analytics'
${cloudflareImports.length > 0 ? `import { ${cloudflareImports.join(', ')} } from '@liria24/analytics/cloudflare'` : ''}
${searchProperty ? "import { googleSearchConsole } from '@liria24/analytics/google-search-console'" : ''}
${nuxtImports.length > 0 ? `import { ${nuxtImports.join(', ')} } from '#imports'` : ''}
import config from '#analytics/server-config'

let analytics
let warnedCloudflare = false
let warnedSearchConsole = false
async function createServerAnalytics(event) {
    ${siteTag ? 'const runtimeConfig = useRuntimeConfig()' : ''}
    const customProviders = typeof config.customProviders === 'function'
      ? await config.customProviders({ event })
      : (config.customProviders || [])
    const providers = [...customProviders]
    ${
        siteTag
            ? `const accountId = config.providers?.cloudflare?.accountId || runtimeConfig.cloudflare?.accountId || process.env.CLOUDFLARE_ACCOUNT_ID
    const apiToken = config.providers?.cloudflare?.apiToken || runtimeConfig.cloudflare?.apiToken || process.env.CLOUDFLARE_API_TOKEN
    if ((!accountId || !apiToken) && !warnedCloudflare) {
      warnedCloudflare = true
      const missing = [!accountId && 'accountId', !apiToken && 'apiToken'].filter(Boolean).join(', ')
      console.warn('[analytics] Cloudflare Web Analytics is unavailable because ' + missing + ' is missing')
    }`
            : ''
    }
    ${
        searchProperty
            ? `const getAccessToken = config.providers?.googleSearchConsole?.getAccessToken
    if (!getAccessToken && !warnedSearchConsole) {
      warnedSearchConsole = true
      console.warn('[analytics] Google Search Console is unavailable because providers.googleSearchConsole.getAccessToken is missing')
    }`
            : ''
    }
    ${
        analyticsEngineBinding
            ? `const analyticsEngineBinding = event?.context.cloudflare?.env?.[${JSON.stringify(analyticsEngineBinding)}] || config.providers?.cloudflare?.bindings?.[${JSON.stringify(analyticsEngineBinding)}]`
            : ''
    }
    ${
        siteTag || analyticsEngineBinding
            ? `providers.push(cloudflare({
      ${siteTag ? 'accountId, apiToken,' : ''}
      ${siteTag ? `webAnalytics: { siteTag: ${JSON.stringify(siteTag)}${host === undefined ? '' : `, host: ${JSON.stringify(host)}`} },` : ''}
      ${analyticsEngineBinding ? '...(analyticsEngineBinding ? { analyticsEngine: { binding: analyticsEngineBinding } } : {}),' : ''}
    }))`
            : ''
    }
    ${searchProperty ? `providers.push(googleSearchConsole({ property: ${JSON.stringify(searchProperty)}, auth: { ...(getAccessToken ? { getAccessToken } : {}) } }))` : ''}
    return createAnalytics({
    name: ${JSON.stringify(options.name)},
    environment: ${JSON.stringify(options.environment ?? 'default')},
    providers,
    events: ${JSON.stringify(options.events ?? {})},
    state: config.state,
    defaults: config.defaults,
    archive: ${archiveExpression},
    })
}

export function useServerAnalytics(event) {
  ${
      analyticsEngineBinding
          ? `if (event?.context.cloudflare?.env?.[${JSON.stringify(analyticsEngineBinding)}]) {
    return createServerAnalytics(event)
  }`
          : ''
  }
  if (typeof config.customProviders === 'function') return createServerAnalytics(event)
  return analytics ||= createServerAnalytics()
}

export async function deliverEvents(events, event) {
  ${
      analyticsEngineBinding
          ? `const binding = event.context.cloudflare?.env?.[${JSON.stringify(analyticsEngineBinding)}] || config.providers?.cloudflare?.bindings?.[${JSON.stringify(analyticsEngineBinding)}]
  if (!binding) throw new Error('Cloudflare Analytics Engine binding is missing')
  const sink = cloudflareAnalyticsEngine({ binding }).eventDestination
  await Promise.all(events.map((item) => sink.track(item)))`
          : ''
  }
  ${analyticsEngineBinding ? '' : "if (!config.eventHandler) throw new Error('No analytics event handler is configured')"}
  if (config.eventHandler) await config.eventHandler(events, event)
}
`
}

function createBrowserRuntimeTemplate(
    events: NonNullable<NuxtAnalyticsModuleOptions['events']>,
    relay: Required<NuxtAnalyticsRelayOptions>,
): string {
    return `import { createBrowserAnalytics } from '@liria24/analytics/browser'
import type { BrowserAnalytics } from '@liria24/analytics/browser'
import type { AnalyticsEventName, AnalyticsEventProperties } from '@liria24/analytics'
const definitions = ${JSON.stringify(events)} as const
type Config = { events: typeof definitions }
type Events = { [Name in AnalyticsEventName<Config>]: AnalyticsEventProperties<Config, Name> }
let analytics: BrowserAnalytics<Events> | undefined
export function useAnalytics(): BrowserAnalytics<Events> {
  return analytics ||= createBrowserAnalytics<Events>({
    endpoint: ${JSON.stringify(relay.route)},
    maxBatchSize: ${relay.maxBatchSize},
  })
}
`
}

function createEventHandlerTemplate(
    events: NonNullable<NuxtAnalyticsModuleOptions['events']>,
    relay: Required<NuxtAnalyticsRelayOptions>,
): string {
    return `import { createAnalyticsEventHandler } from '@liria24/analytics/nuxt/runtime'
import { deliverEvents } from '#analytics/server'
export default createAnalyticsEventHandler({
  deliver: (events, event) => deliverEvents(events, event),
  events: ${JSON.stringify(events)},
  maxBatchSize: ${relay.maxBatchSize},
  maxBodySize: ${relay.maxBodySize},
})
`
}

const maintenanceTaskTemplate = `export default defineTask({
  meta: { name: 'analytics:maintenance', description: 'Refresh and prune analytics archive partitions' },
  async run() {
    const analytics = await useServerAnalytics()
    return { result: await analytics.maintenance.run() }
  },
})
`
