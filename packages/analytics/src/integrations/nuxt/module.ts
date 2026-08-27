import { existsSync, readdirSync, readFileSync } from 'node:fs'
import { extname, join } from 'node:path'
import { pathToFileURL } from 'node:url'

import {
    addImports,
    addServerHandler,
    addServerImports,
    addServerTemplate,
    addTemplate,
    defineNuxtModule,
    updateTemplates,
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
            addServerImports([
                { from: '#analytics/server', name: 'deliverEvents' },
                { from: '#analytics/server', name: 'useServerAnalytics' },
            ])

            const styleMode = options.ui?.styles ?? 'auto'
            if (styleMode !== false) {
                const vueStyles = addTemplate({
                    filename: 'analytics/vue.css',
                    getContents: () => createVueStyleTemplate(styleMode, nuxt.options.srcDir),
                    write: true,
                })
                nuxt.options.css.push(vueStyles.dst)
                if (styleMode === 'auto') {
                    nuxt.hook('builder:watch', async (event, path) => {
                        if (
                            event === 'addDir' ||
                            event === 'unlinkDir' ||
                            vueSourceExtensions.has(extname(path))
                        ) {
                            await updateTemplates({
                                filter: (template) => template.dst === vueStyles.dst,
                            })
                        }
                    })
                }
            }

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

const vueSourceExtensions = new Set(['.vue', '.ts', '.tsx', '.js', '.jsx'])
const ignoredSourceDirectories = new Set(['.git', '.nuxt', '.output', 'dist', 'node_modules'])
const analyticsComponentPattern = /\bAnalytics(?:Stat|LineChart|BreakdownTable)\b/
const analyticsNamespacePattern =
    /\b(?:import|export)\s*\*\s*(?:as\s+[\w$]+\s*)?from\s*['"]@liria24\/analytics\/vue['"]/
const analyticsDynamicImportPattern = /\bimport\s*\(\s*['"]@liria24\/analytics\/vue['"]\s*\)/

export function sourceUsesAnalyticsVueComponents(source: string): boolean {
    return (
        analyticsComponentPattern.test(source) ||
        analyticsNamespacePattern.test(source) ||
        analyticsDynamicImportPattern.test(source)
    )
}

export function directoryUsesAnalyticsVueComponents(directory: string): boolean {
    for (const entry of readdirSync(directory, { withFileTypes: true })) {
        if (entry.isDirectory()) {
            if (
                !ignoredSourceDirectories.has(entry.name) &&
                directoryUsesAnalyticsVueComponents(join(directory, entry.name))
            ) {
                return true
            }
        } else if (
            entry.isFile() &&
            vueSourceExtensions.has(extname(entry.name)) &&
            sourceUsesAnalyticsVueComponents(readFileSync(join(directory, entry.name), 'utf8'))
        ) {
            return true
        }
    }
    return false
}

export function createVueStyleTemplate(mode: true | 'auto', sourceDirectory: string): string {
    return mode === true || directoryUsesAnalyticsVueComponents(sourceDirectory)
        ? "@import '@liria24/analytics/vue/style.css';\n"
        : '/* empty */\n'
}

function createServerConfigTemplate(userConfigPath: string): string {
    const userConfigImport = existsSync(userConfigPath)
        ? `import userConfig from ${JSON.stringify(pathToFileURL(userConfigPath).href)}`
        : 'const userConfig = {}'
    return `${userConfigImport}
const config = typeof userConfig === 'function' ? await userConfig() : userConfig
export default { ...config, adapters: config.adapters || [] }
`
}

export function resolveArchiveBase(options: NuxtAnalyticsModuleOptions): string {
    return typeof options.archive === 'object'
        ? (options.archive.base ?? 'analytics:archive')
        : 'analytics:archive'
}

export function createServerRuntimeTemplate(options: NuxtAnalyticsModuleOptions): string {
    const archive = typeof options.archive === 'object' ? options.archive : {}
    const r2 = options.providers?.cloudflare?.r2
    const r2Binding = typeof r2 === 'string' ? r2 : r2?.binding
    const archiveEnabled = Boolean(options.archive || r2Binding)
    const archiveBase = resolveArchiveBase(options)
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
import { useRuntimeConfig, useStorage } from '#imports'
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
