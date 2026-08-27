import type { H3Event } from 'h3'

import type { CloudflareAnalyticsEngineBinding } from '../../adapters/cloudflare'
import type {
    AnalyticsClient,
    AnalyticsProvider,
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
    customProviders?:
        | readonly AnalyticsProvider[]
        | ((context: {
              event?: H3Event
          }) => Promise<readonly AnalyticsProvider[]> | readonly AnalyticsProvider[])
    defaults?: Readonly<Record<string, string>>
    providers?: {
        cloudflare?: {
            accountId?: string
            apiToken?: string
            bindings?: Readonly<Record<string, CloudflareAnalyticsEngineBinding>>
        }
        googleSearchConsole?: {
            getAccessToken?(): Promise<string>
        }
    }
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
