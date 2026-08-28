import type {
    BreakdownQuery,
    Filter,
    Grain,
    ReportOperation,
    SeriesQuery,
    SummaryQuery,
    TimeRange,
} from '../../core/types.ts'

type ProviderReportQuery = BreakdownQuery | SeriesQuery | SummaryQuery

export interface ResolvedReportQuery {
    dimensions: readonly string[]
    filters?: Filter
    grain: Grain | 'auto'
    limit?: number
    metrics: readonly string[]
    range: TimeRange
    source: string
    timezone: string
}

export const resolvedReportQuery = (
    source: string,
    operation: Exclude<ReportOperation, 'snapshot'>,
    query: ProviderReportQuery,
    timeDimension: string,
): ResolvedReportQuery => ({
    ...(query.filters ? { filters: query.filters } : {}),
    ...('limit' in query && query.limit !== undefined ? { limit: query.limit } : {}),
    dimensions:
        operation === 'series'
            ? [timeDimension]
            : operation === 'breakdown' && 'dimensions' in query
              ? query.dimensions
              : [],
    grain:
        operation === 'series'
            ? 'grain' in query
                ? (query.grain ?? 'day')
                : 'day'
            : 'grain' in query
              ? (query.grain ?? 'auto')
              : 'auto',
    metrics: query.metrics,
    range: query.range,
    source,
    timezone: query.timezone ?? 'UTC',
})
