import { existsSync } from 'node:fs'
import { join } from 'node:path'
import { pathToFileURL } from 'node:url'

import {
    addImports,
    addServerHandler,
    addServerImports,
    addTemplate,
    defineNuxtModule,
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

            const events = options.events ?? {}
            const r2 = options.providers?.cloudflare?.r2
            const r2Binding = typeof r2 === 'string' ? r2 : r2?.binding
            const archiveEnabled = Boolean(options.archive || r2Binding)
            const archiveBase =
                r2Binding || typeof options.archive !== 'object'
                    ? 'analytics:archive'
                    : (options.archive.base ?? 'analytics:archive')
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
            const serverConfig = addTemplate({
                filename: 'analytics/server-config.mjs',
                getContents: () => createServerConfigTemplate(userConfigPath),
                write: true,
            })
            nuxt.options.alias['#analytics/server-config'] = serverConfig.dst

            const serverRuntime = addTemplate({
                filename: 'analytics/server.mjs',
                getContents: () => createServerRuntimeTemplate(options),
                write: true,
            })
            nuxt.options.alias['#analytics/server'] = serverRuntime.dst
            addServerImports([
                { from: serverRuntime.dst, name: 'deliverEvents' },
                { from: serverRuntime.dst, name: 'useServerAnalytics' },
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
                        configureR2Storage(nitroConfig, 'analytics:archive', r2Binding)
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
export default { ...config, adapters: config.adapters || [] }
`
}

export function createServerRuntimeTemplate(options: NuxtAnalyticsModuleOptions): string {
    const archive = typeof options.archive === 'object' ? options.archive : {}
    const r2 = options.providers?.cloudflare?.r2
    const r2Binding = typeof r2 === 'string' ? r2 : r2?.binding
    const archiveEnabled = Boolean(options.archive || r2Binding)
    const archiveBase =
        r2Binding || typeof options.archive !== 'object'
            ? 'analytics:archive'
            : (options.archive.base ?? 'analytics:archive')
    const archiveExpression = archiveEnabled
        ? `{ storage: useStorage(${JSON.stringify(archiveBase)}), ${
              archive.retention ? `retention: ${JSON.stringify(archive.retention)}` : ''
          } }`
        : 'undefined'

    const webAnalytics = options.providers?.cloudflare?.webAnalytics
    const siteTag = typeof webAnalytics === 'string' ? webAnalytics : webAnalytics?.siteTag
    const searchConsole = options.providers?.searchConsole
    const searchProperty =
        typeof searchConsole === 'string' ? searchConsole : searchConsole?.property
    const analyticsEngine = options.providers?.cloudflare?.analyticsEngine
    const analyticsEngineBinding =
        typeof analyticsEngine === 'string' ? analyticsEngine : analyticsEngine?.binding
    const analyticsConfig = `{ events: ${JSON.stringify(options.events ?? {})}, state: config.state }`

    return `import { createAnalytics } from '@liria24/analytics'
import { cloudflareAnalyticsEngine, cloudflareWebAnalytics } from '@liria24/analytics/cloudflare'
import { googleSearchConsole } from '@liria24/analytics/google-search-console'
import config from '#analytics/server-config'

let analytics
function createServerAnalytics(event) {
    const runtimeConfig = useRuntimeConfig()
    const adapters = [...(config.adapters || [])]
    ${
        siteTag
            ? `const accountId = config.cloudflare?.accountId || runtimeConfig.cloudflare?.accountId || process.env.CLOUDFLARE_ACCOUNT_ID
    const apiToken = config.cloudflare?.apiToken || runtimeConfig.cloudflare?.apiToken || process.env.CLOUDFLARE_API_TOKEN
    if (!accountId || !apiToken) throw new Error('Cloudflare Web Analytics credentials are missing')
    adapters.push(cloudflareWebAnalytics({ accountId, apiToken, siteTag: ${JSON.stringify(siteTag)} }))`
            : ''
    }
    ${
        searchProperty
            ? `const getAccessToken = config.auth?.searchConsole?.getAccessToken
    if (!getAccessToken) throw new Error('Search Console auth.searchConsole.getAccessToken is missing')
    adapters.push(googleSearchConsole({ property: ${JSON.stringify(searchProperty)}, auth: { getAccessToken } }))`
            : ''
    }
    ${
        analyticsEngineBinding
            ? `const analyticsEngineBinding = event?.context.cloudflare?.env?.[${JSON.stringify(analyticsEngineBinding)}] || config.cloudflare?.bindings?.[${JSON.stringify(analyticsEngineBinding)}]
    if (analyticsEngineBinding) {
      const eventSink = cloudflareAnalyticsEngine({ binding: analyticsEngineBinding }).sink
      adapters.push({ adapters: [], eventSink })
    }`
            : ''
    }
    return createAnalytics({
    name: ${JSON.stringify(options.name)},
    environment: ${JSON.stringify(options.environment ?? 'default')},
    adapters,
    config: ${analyticsConfig},
    defaultSources: config.defaultSources,
    archive: ${archiveExpression},
    })
}

export function useServerAnalytics(event) {
  ${
      analyticsEngineBinding
          ? `if (event?.context.cloudflare?.env?.[${JSON.stringify(analyticsEngineBinding)}]) {
    return Promise.resolve(createServerAnalytics(event))
  }`
          : ''
  }
  return analytics ||= Promise.resolve().then(() => createServerAnalytics())
}

export async function deliverEvents(events, event) {
  ${
      analyticsEngineBinding
          ? `const binding = event.context.cloudflare?.env?.[${JSON.stringify(analyticsEngineBinding)}] || config.cloudflare?.bindings?.[${JSON.stringify(analyticsEngineBinding)}]
  if (!binding) throw new Error('Cloudflare Analytics Engine binding is missing')
  const sink = cloudflareAnalyticsEngine({ binding }).sink
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
