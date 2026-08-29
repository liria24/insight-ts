import type {
    CanonicalWhere,
    Grain,
    NormalizedMetricQuery,
    TimeRange,
} from '../../metrics/index.ts'

export interface ResolvedMetricQuery {
    dimensions: readonly string[]
    grain: Grain | 'auto'
    limit?: number
    metrics: readonly string[]
    range: TimeRange
    source: string
    timezone: string
    where?: CanonicalWhere
}

export const resolvedMetricQuery = (
    source: string,
    query: NormalizedMetricQuery,
    timeDimension: string,
): ResolvedMetricQuery => ({
    dimensions: [
        ...(query.grain === 'auto' ? [] : [timeDimension]),
        ...query.dimensions.filter((dimension) => dimension !== timeDimension),
    ],
    grain: query.grain,
    ...(query.limit === undefined ? {} : { limit: query.limit }),
    metrics: query.metrics,
    range: query.time,
    source,
    timezone: query.timezone,
    ...(query.where ? { where: query.where } : {}),
})
