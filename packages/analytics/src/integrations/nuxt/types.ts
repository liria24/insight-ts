import type { H3Event } from 'h3'

import type { CloudflareAnalyticsEngineBinding } from '../../adapters/cloudflare'
import type {
    AnalyticsAdapterInput,
    AnalyticsClient,
    AnalyticsConfig,
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

export interface NuxtAnalyticsServerEvent {
    id: string
    name: string
    origin: 'client'
    properties: Record<string, boolean | number | string>
    timestamp: string
}

export interface NuxtAnalyticsServerConfig {
    adapters?: readonly AnalyticsAdapterInput[]
    cloudflare?: {
        accountId?: string
        apiToken?: string
        bindings?: Readonly<Record<string, CloudflareAnalyticsEngineBinding>>
    }
    config?: AnalyticsConfig
    defaultSources?: Readonly<Record<string, string>>
    eventHandler?(events: readonly NuxtAnalyticsServerEvent[], event: H3Event): Promise<void> | void
    getAccessToken?(): Promise<string>
}

export interface NuxtAnalyticsServerRuntime {
    deliverEvents(events: readonly NuxtAnalyticsServerEvent[], event: H3Event): Promise<void>
    useServerAnalytics(event?: H3Event): Promise<AnalyticsClient>
}

export type NuxtAnalyticsEventDefinitions = Readonly<
    Record<string, { properties?: Readonly<Record<string, AnalyticsEventProperty>> }>
>

export function defineNuxtAnalyticsConfig(
    config: NuxtAnalyticsServerConfig,
): NuxtAnalyticsServerConfig {
    return config
}

declare module 'nuxt/schema' {
    interface NuxtConfig {
        analytics?: NuxtAnalyticsModuleOptions
    }

    interface NuxtOptions {
        analytics?: NuxtAnalyticsModuleOptions
    }
}
