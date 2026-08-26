import { inject, provide, type InjectionKey } from 'vue'

import type { AnalyticsEventMap, BrowserAnalytics } from './browser'

export {
    AnalyticsBreakdownTable,
    AnalyticsLineChart,
    AnalyticsStat,
    type AnalyticsBreakdownTableProps,
    type AnalyticsChartSeries,
    type AnalyticsLineChartProps,
    type AnalyticsStatProps,
} from './vue-ui'

export const analyticsKey: InjectionKey<unknown> = Symbol('analytics')

export function provideAnalytics<Events extends object>(analytics: BrowserAnalytics<Events>): void {
    provide(analyticsKey, analytics)
}

export function useAnalytics<
    Events extends object = AnalyticsEventMap,
>(): BrowserAnalytics<Events> {
    const analytics = inject(analyticsKey)
    if (!isBrowserAnalytics(analytics)) throw new Error('Analytics was not provided')
    return analytics
}

function isBrowserAnalytics(value: unknown): value is BrowserAnalytics<object> {
    return (
        typeof value === 'object' &&
        value !== null &&
        'flush' in value &&
        typeof value.flush === 'function' &&
        'track' in value &&
        typeof value.track === 'function'
    )
}
