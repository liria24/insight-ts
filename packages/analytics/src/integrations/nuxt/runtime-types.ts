import type { H3Event } from 'h3'

import type { CloudflareAnalyticsEngineBinding } from '../../adapters/cloudflare'
import type {
    AnalyticsAdapterInput,
    AnalyticsClient,
    AnalyticsStateConfig,
    AnalyticsStateMetricDefinitions,
} from '../../core/types'

export interface NuxtAnalyticsServerEvent {
    id: string
    name: string
    origin: 'client'
    properties: Record<string, boolean | number | string>
    timestamp: string
}

export interface NuxtAnalyticsServerConfig<
    TState extends AnalyticsStateMetricDefinitions = AnalyticsStateMetricDefinitions,
> {
    adapters?: readonly AnalyticsAdapterInput[]
    auth?: {
        searchConsole?: {
            getAccessToken(): Promise<string>
        }
    }
    cloudflare?: {
        accountId?: string
        apiToken?: string
        bindings?: Readonly<Record<string, CloudflareAnalyticsEngineBinding>>
    }
    defaultSources?: Readonly<Record<string, string>>
    eventHandler?(events: readonly NuxtAnalyticsServerEvent[], event: H3Event): Promise<void> | void
    state?: AnalyticsStateConfig<TState>
}

export interface NuxtAnalyticsServerRuntime {
    deliverEvents(events: readonly NuxtAnalyticsServerEvent[], event: H3Event): Promise<void>
    useServerAnalytics(event?: H3Event): Promise<AnalyticsClient>
}

export function defineNuxtAnalyticsConfig<
    const TState extends AnalyticsStateMetricDefinitions = {},
>(config: NuxtAnalyticsServerConfig<TState>): NuxtAnalyticsServerConfig<TState> {
    return config
}
