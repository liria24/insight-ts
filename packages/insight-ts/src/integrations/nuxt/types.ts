export interface NuxtInsightHistoryOptions {
    capabilities?: readonly string[]
    scopes?: readonly string[]
    tasks?: boolean
}

export interface NuxtInsightBrowserOptions {
    scope?: string
}

export interface NuxtCloudflareProviderOptions {
    webAnalytics?: boolean
}

export interface NuxtInsightProviderOptions {
    cloudflare?: NuxtCloudflareProviderOptions
}

export interface NuxtInsightModuleOptions {
    browser?: false | NuxtInsightBrowserOptions
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
