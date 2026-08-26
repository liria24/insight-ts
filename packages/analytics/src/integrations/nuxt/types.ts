import type {
    AnalyticsDuration,
    AnalyticsEventDefinitions,
    AnalyticsEventProperty,
} from '../../core/types'

export interface NuxtAnalyticsArchiveOptions {
    base?: string
    retention?: AnalyticsDuration
}

export interface NuxtAnalyticsModuleOptions {
    archive?: boolean | NuxtAnalyticsArchiveOptions
    environment?: string
    events?: AnalyticsEventDefinitions
    name: string
    providers?: {
        cloudflare?: {
            analyticsEngine?: string | { binding: string }
            r2?: string | { binding: string }
            webAnalytics?: string | { siteTag: string }
        }
        searchConsole?: string | { property: string }
    }
    relay?: {
        maxBatchSize?: number
        maxBodySize?: number
        route?: string
    }
}

export type NuxtAnalyticsEventDefinitions = Readonly<
    Record<string, { properties?: Readonly<Record<string, AnalyticsEventProperty>> }>
>

declare module 'nuxt/schema' {
    interface NuxtConfig {
        analytics?: NuxtAnalyticsModuleOptions
    }

    interface NuxtOptions {
        analytics?: NuxtAnalyticsModuleOptions
    }

    interface NuxtHooks {
        'nitro:config': (nitroConfig: unknown) => void
    }
}
