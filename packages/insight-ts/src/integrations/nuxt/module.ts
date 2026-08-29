import { existsSync } from 'node:fs'
import { join } from 'node:path'
import { pathToFileURL } from 'node:url'

import {
    addServerImports,
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
    historySources: readonly string[]
}

interface ServerRuntimeTypeTemplateOptions extends ServerRuntimeTemplateOptions {
    history: boolean
    userConfigPath?: string
}

const module: NuxtModule<NuxtInsightModuleOptions> = defineNuxtModule<NuxtInsightModuleOptions>({
    meta: {
        compatibility: { nuxt: '>=4.5.1' },
        configKey: 'insight',
        name: 'insight-ts',
    },
    setup(options, nuxt) {
        const sources = options.history?.sources ?? []
        const cloudflareWebAnalytics = options.providers?.cloudflare?.webAnalytics === true
        if (options.history && sources.length === 0) {
            throw new TypeError('insight.history.sources must contain at least one Source')
        }

        const userConfigPath = join(nuxt.options.srcDir, 'server', 'insight.config.ts')
        const getConfig = () => createServerConfigTemplate(userConfigPath)
        addTemplate({ filename: 'insight/server-config.mjs', getContents: getConfig, write: true })
        addServerTemplate({ filename: '#insight/server-config', getContents: getConfig })

        const getRuntime = () =>
            createServerRuntimeTemplate({ cloudflareWebAnalytics, historySources: sources })
        addTemplate({ filename: 'insight/server.mjs', getContents: getRuntime, write: true })
        addServerTemplate({ filename: '#insight/server', getContents: getRuntime })
        const runtimeTypes = addTypeTemplate(
            {
                filename: 'insight/server-runtime.d.ts',
                getContents: () =>
                    createServerRuntimeTypeTemplate({
                        cloudflareWebAnalytics,
                        history: Boolean(options.history),
                        historySources: sources,
                        ...(existsSync(userConfigPath) ? { userConfigPath } : {}),
                    }),
            },
            { nitro: true },
        )
        addServerImports([
            { from: '#insight/server', name: 'useInsight', typeFrom: runtimeTypes.dst },
        ])

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
    historySources,
}: ServerRuntimeTemplateOptions): string => {
    const historyImports =
        historySources.length > 0
            ? `import { createHistory } from 'insight-ts/history'\nimport { createNitroHistoryRepository } from 'insight-ts/nitro'\nimport { useStorage } from '#imports'\n`
            : ''
    const cloudflareImports = cloudflareWebAnalytics
        ? `import { cloudflareWebAnalytics } from 'insight-ts/cloudflare'\nimport { useRuntimeConfig } from '#imports'\n`
        : ''
    const history =
        historySources.length > 0
            ? `, history: createHistory({ repository: createNitroHistoryRepository(useStorage('insight')), sources: ${JSON.stringify(historySources)} })`
            : ''
    const providerSetup = cloudflareWebAnalytics
        ? `const runtimeConfig = useRuntimeConfig()\n  const cloudflareConfig = runtimeConfig.cloudflare ?? {}\n  const providers = [...config.providers, {\n    id: 'cloudflare',\n    sources: {\n      webAnalytics: cloudflareWebAnalytics({\n        accountId: cloudflareConfig.accountId ?? '',\n        apiToken: cloudflareConfig.apiToken ?? '',\n        host: cloudflareConfig.host,\n        siteTag: cloudflareConfig.siteTag ?? '',\n      }),\n    },\n  }]`
        : 'const providers = config.providers'
    return `import { createInsight } from 'insight-ts'
${historyImports}${cloudflareImports}import config from '#insight/server-config'

let instance
export const useInsight = () => {
  ${providerSetup}
  return instance ||= createInsight({ ...config, providers${history} })
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
        ? `import type { cloudflareWebAnalytics } from 'insight-ts/cloudflare'\nimport type { ProviderDefinition } from 'insight-ts'\n`
        : ''
    const cloudflareProvider = cloudflareWebAnalytics
        ? `type CloudflareProvider = ProviderDefinition<'cloudflare', { readonly webAnalytics: ReturnType<typeof cloudflareWebAnalytics> }>`
        : ''
    const providers = cloudflareWebAnalytics
        ? "readonly [...ServerConfig['providers'], CloudflareProvider]"
        : "ServerConfig['providers']"
    return `${serverConfig}
${cloudflareImport}import type { HistoryExtension, InsightClient } from 'insight-ts'

${cloudflareProvider}
type RuntimeConfig = Omit<ServerConfig, 'providers'> & { readonly providers: ${providers} }${history ? ' & { history: HistoryExtension }' : ''}
export declare const useInsight: () => InsightClient<RuntimeConfig>
`
}

const historySyncTaskTemplate = `import { useInsight } from '#insight/server'
export default defineTask({
  meta: { name: 'insight:history:sync', description: 'Synchronize Insight History gaps' },
  run({ payload }) { return useInsight().history.sync({ range: payload.range, sources: payload.sources }) }
})
`
