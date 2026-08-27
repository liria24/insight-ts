import type { AnalyticsProvider } from './core/types'

export function defineAnalyticsProvider<const TProvider extends AnalyticsProvider>(
    provider: TProvider,
): TProvider {
    return provider
}

export type {
    AnalyticsBreakdownResult,
    AnalyticsDimensionDefinition,
    AnalyticsEventDestination,
    AnalyticsMetricDefinition,
    AnalyticsProvider,
    AnalyticsSeriesResult,
    AnalyticsSource,
    AnalyticsSourceArchive,
    AnalyticsSourceDescriptor,
    AnalyticsSourceQueryContext,
    AnalyticsSummaryResult,
} from './core/types'
