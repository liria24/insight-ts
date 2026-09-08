import { existsSync } from 'node:fs'
import { join } from 'node:path'
import { pathToFileURL } from 'node:url'

import {
    addServerImports,
    addServerHandler,
    addServerTemplate,
    addTemplate,
    addTypeTemplate,
    defineNuxtModule,
} from 'nuxt/kit'
import type { NuxtModule } from 'nuxt/schema'

import { configureNitroHistory } from '../nitro/index.ts'
import type { NuxtInsightModuleOptions } from './types.ts'

interface ServerRuntimeTemplateOptions {
    cloudflareWebAnalytics: boolean
    history: false | { capabilities?: readonly string[]; scopes?: readonly string[] }
}

interface ServerRuntimeTypeTemplateOptions {
    cloudflareWebAnalytics: boolean
    history: boolean
    userConfigPath?: string
}

interface BrowserRelayTemplateOptions {
    scope?: string
}

const module: NuxtModule<NuxtInsightModuleOptions> = defineNuxtModule<NuxtInsightModuleOptions>({
    meta: {
        compatibility: { nuxt: '>=4.5.1' },
        configKey: 'insight',
        name: 'insight-ts',
    },
    setup(options, nuxt) {
        const history = options.history
            ? {
                  ...(options.history.capabilities
                      ? { capabilities: options.history.capabilities }
                      : {}),
                  ...(options.history.scopes ? { scopes: options.history.scopes } : {}),
              }
            : false
        const cloudflareWebAnalytics = options.providers?.cloudflare?.webAnalytics === true

        const userConfigPath = join(nuxt.options.srcDir, 'server', 'insight.config.ts')
        const getConfig = () => createServerConfigTemplate(userConfigPath)
        addTemplate({ filename: 'insight/server-config.mjs', getContents: getConfig, write: true })
        addServerTemplate({ filename: '#insight/server-config', getContents: getConfig })

        const getRuntime = () => createServerRuntimeTemplate({ cloudflareWebAnalytics, history })
        addTemplate({ filename: 'insight/server.mjs', getContents: getRuntime, write: true })
        addServerTemplate({ filename: '#insight/server', getContents: getRuntime })
        const runtimeTypes = addTypeTemplate(
            {
                filename: 'insight/server-runtime.d.ts',
                getContents: () =>
                    createServerRuntimeTypeTemplate({
                        cloudflareWebAnalytics,
                        history: Boolean(options.history),
                        ...(existsSync(userConfigPath) ? { userConfigPath } : {}),
                    }),
            },
            { nitro: true },
        )
        addServerImports([
            { from: '#insight/server', name: 'useInsight', typeFrom: runtimeTypes.dst },
        ])

        if (options.browser !== false) {
            const relay = addTemplate({
                filename: 'insight/event-relay.mjs',
                getContents: () =>
                    createBrowserRelayTemplate(
                        options.browser && options.browser.scope
                            ? { scope: options.browser.scope }
                            : {},
                    ),
                write: true,
            })
            addServerHandler({ handler: relay.dst, route: '/api/_insight/events' })
        }

        if (!options.history) return
        let handlers: { syncHandler: string } | undefined
        if (options.history.tasks) {
            const sync = addTemplate({
                filename: 'insight/history-sync.mjs',
                getContents: () => historySyncTaskTemplate,
                write: true,
            })
            handlers = { syncHandler: sync.dst }
        }
        nuxt.hook('nitro:config', (nitroConfig) => configureNitroHistory(nitroConfig, handlers))
    },
})

export default module

export const createServerConfigTemplate = (path: string): string =>
    existsSync(path)
        ? `export { default } from ${JSON.stringify(pathToFileURL(path).href)}\n`
        : 'export default { providers: [] }\n'

export const createServerRuntimeTemplate = ({
    cloudflareWebAnalytics,
    history,
}: ServerRuntimeTemplateOptions): string => {
    const historyImports = history
        ? `import { createHistory } from 'insight-ts/history'\nimport { createNitroHistoryRepository } from 'insight-ts/nitro'\nimport { useStorage } from '#imports'\n`
        : ''
    const cloudflareImports = cloudflareWebAnalytics
        ? `import { cloudflare } from 'insight-ts/cloudflare'\nimport { useRuntimeConfig } from '#imports'\n`
        : ''
    const historySetup = history
        ? `, history: createHistory({ repository: createNitroHistoryRepository(useStorage('insight'))${history.capabilities ? `, capabilities: ${JSON.stringify(history.capabilities)}` : ''}${history.scopes ? `, scopes: ${JSON.stringify(history.scopes)}` : ''} })`
        : ''
    const configValidation = cloudflareWebAnalytics
        ? `if (!Array.isArray(config.providers)) throw new TypeError('Nuxt Cloudflare Web Analytics auto-configuration requires a single-Scope server config; configure Cloudflare in server/insight.config.ts when using scopes')\n\n`
        : ''
    const providerSetup = cloudflareWebAnalytics
        ? `const runtimeConfig = useRuntimeConfig()\n  const cloudflareConfig = runtimeConfig.cloudflare ?? {}\n  const providers = [...config.providers, cloudflare({\n    accountId: cloudflareConfig.accountId ?? '',\n    apiToken: cloudflareConfig.apiToken ?? '',\n    webAnalytics: {\n      host: cloudflareConfig.host,\n      siteTag: cloudflareConfig.siteTag ?? '',\n    },\n  })]`
        : 'const providers = config.providers'
    return `import { createInsight } from 'insight-ts'
${historyImports}${cloudflareImports}import config from '#insight/server-config'

${configValidation}let instance
export const useInsight = () => {
  if (instance) return instance
  ${providerSetup}
  return instance = createInsight({ ...config, providers${historySetup} })
}
`
}

export const createServerRuntimeTypeTemplate = ({
    cloudflareWebAnalytics,
    history,
    userConfigPath,
}: ServerRuntimeTypeTemplateOptions): string => {
    const serverConfig = userConfigPath
        ? `import config from ${JSON.stringify(pathToFileURL(userConfigPath).href)}\ntype ServerConfig = typeof config`
        : 'type ServerConfig = { readonly providers: readonly [] }'
    const cloudflareImport = cloudflareWebAnalytics
        ? `import type { cloudflare } from 'insight-ts/cloudflare'\n`
        : ''
    const cloudflareProvider = cloudflareWebAnalytics
        ? `type CloudflareProvider = ReturnType<typeof cloudflare<{ readonly webAnalytics: { readonly siteTag: string } }>>`
        : ''
    const coreTypes = cloudflareWebAnalytics
        ? 'HistoryExtension, InsightClient, ProviderDefinition'
        : 'HistoryExtension, InsightClient'
    const runtimeConfig = cloudflareWebAnalytics
        ? "ServerConfig extends { readonly providers: infer Providers extends readonly ProviderDefinition[] } ? Omit<ServerConfig, 'providers'> & { readonly providers: readonly [...Providers, CloudflareProvider] } : never"
        : 'ServerConfig'
    return `${serverConfig}
${cloudflareImport}import type { ${coreTypes} } from 'insight-ts'

${cloudflareProvider}
type RuntimeConfig = (${runtimeConfig})${history ? ' & { history: HistoryExtension }' : ''}
export declare const useInsight: () => InsightClient<RuntimeConfig>
`
}

export const createBrowserRelayTemplate = ({ scope }: BrowserRelayTemplateOptions): string => {
    const client = scope ? `useInsight().scope(${JSON.stringify(scope)})` : 'useInsight()'
    return `import { fromWebHandler } from 'h3'
import { createNitroEventRelay } from 'insight-ts/nitro'
import config from '#insight/server-config'
import { useInsight } from '#insight/server'

export default fromWebHandler(createNitroEventRelay({
  events: config.events,
  track(name, properties) {
    const client = ${client}
    if (typeof client.track !== 'function') throw new TypeError('Insight browser relay requires insight.browser.scope when using multiple Scopes')
    return client.track(name, properties)
  },
}))
`
}

const historySyncTaskTemplate = `import { useInsight } from '#insight/server'
export default defineTask({
  meta: { name: 'insight:history:sync', description: 'Synchronize Insight History gaps' },
  run({ payload }) { return useInsight().history.sync({ range: payload.range, scopes: payload.scopes, capabilities: payload.capabilities }) }
})
`
