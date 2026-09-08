import type {
    CanonicalWhere,
    Grain,
    MetricProjection,
    NormalizedMetricQuery,
    TimeRange,
} from '../../metrics/index.ts'

export interface ResolvedMetricQuery {
    dimensions: readonly string[]
    grain: Grain | 'auto'
    limit?: number
    metrics: readonly string[]
    projection: MetricProjection
    range: TimeRange
    source: string
    timezone: string
    where?: CanonicalWhere
}

export const resolvedMetricQuery = (
    source: string,
    query: NormalizedMetricQuery,
    timeDimension: string,
): ResolvedMetricQuery => {
    const rows = query.projection !== 'aggregate'
    return {
        dimensions: rows
            ? [
                  ...(query.grain === 'auto' && !query.dimensions.includes(timeDimension)
                      ? []
                      : [timeDimension]),
                  ...query.dimensions.filter((dimension) => dimension !== timeDimension),
              ]
            : [],
        grain: rows ? query.grain : 'auto',
        ...(rows && query.limit !== undefined ? { limit: query.limit } : {}),
        metrics: query.metrics,
        projection: query.projection,
        range: query.time,
        source,
        timezone: query.timezone,
        ...(query.where ? { where: query.where } : {}),
    }
}
