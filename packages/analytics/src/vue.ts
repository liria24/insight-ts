import { inject, provide, type InjectionKey } from 'vue'

import type { AnalyticsEventMap, BrowserAnalytics } from './browser'

export {
    type AnalyticsBreakdownTableProps,
    type AnalyticsBreakdownTableUI,
    type AnalyticsChartSeries,
    type AnalyticsChartTooltipValue,
    type AnalyticsLineChartProps,
    type AnalyticsLineChartUI,
    type AnalyticsStatProps,
    type AnalyticsStatUI,
    type AnalyticsTimeFormatContext,
    type AnalyticsTimezone,
    type AnalyticsUIClass,
    type AnalyticsXAxisOptions,
    type AnalyticsYAxisDomain,
    type AnalyticsYAxisOptions,
    createAnalyticsTimeFormatContext,
    formatAnalyticsTime,
    resolveAnalyticsTimezone,
} from './vue-ui'
export { default as AnalyticsBreakdownTable } from './components/AnalyticsBreakdownTable.vue'
export { default as AnalyticsLineChart } from './components/AnalyticsLineChart.vue'
export { default as AnalyticsStat } from './components/AnalyticsStat.vue'

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
