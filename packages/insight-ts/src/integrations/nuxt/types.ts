export interface NuxtInsightHistoryOptions {
    sources: readonly string[]
    tasks?: boolean
}

export interface NuxtCloudflareProviderOptions {
    webAnalytics?: boolean
}

export interface NuxtInsightProviderOptions {
    cloudflare?: NuxtCloudflareProviderOptions
}

export interface NuxtInsightModuleOptions {
    history?: NuxtInsightHistoryOptions
    providers?: NuxtInsightProviderOptions
}

declare module 'nuxt/schema' {
    interface NuxtConfig {
        insight?: NuxtInsightModuleOptions
    }

    interface NuxtOptions {
        insight?: NuxtInsightModuleOptions
    }

    interface NuxtHooks {
        'nitro:config': (nitroConfig: unknown) => void
    }
}
