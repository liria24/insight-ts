import { InsightError } from './errors.ts'
import type {
    DimensionDefinitions,
    Filter,
    MetricDefinitions,
    ReportSourceDefinition,
    TimeRange,
} from './types.ts'

export const normalizeTimeRange = (range: TimeRange): TimeRange => {
    const from = new Date(range.from)
    const to = new Date(range.to)
    if (!Number.isFinite(from.valueOf()) || !Number.isFinite(to.valueOf()) || from >= to) {
        throw new InsightError(
            'INVALID_QUERY',
            'Range must contain valid absolute from and to timestamps with from before to',
        )
    }
    return { from: from.toISOString(), to: to.toISOString() }
}

export const filterFields = (filter: Filter): string[] => {
    if ('field' in filter) return [filter.field]
    if ('not' in filter) return filterFields(filter.not)
    return ('and' in filter ? filter.and : filter.or).flatMap(filterFields)
}

export const metricDefinitions = (source: ReportSourceDefinition): MetricDefinitions =>
    source.metrics

export const dimensionDefinitions = (source: ReportSourceDefinition): DimensionDefinitions =>
    source.dimensions ?? {}

export const validateSelection = (
    sourceId: string,
    source: ReportSourceDefinition,
    query: {
        dimensions?: readonly string[]
        filters?: Filter
        limit?: number
        metrics: readonly string[]
        range?: TimeRange
    },
): void => {
    if (query.metrics.length === 0) {
        throw new InsightError('INVALID_QUERY', 'At least one metric is required')
    }
    const metrics = new Set(Object.keys(metricDefinitions(source)))
    const dimensions = new Set(Object.keys(dimensionDefinitions(source)))
    for (const metric of query.metrics) {
        if (!metrics.has(metric)) {
            throw new InsightError(
                'UNSUPPORTED_METRIC',
                `Report Source "${sourceId}" does not support metric "${metric}"`,
            )
        }
    }
    for (const dimension of query.dimensions ?? []) {
        if (!dimensions.has(dimension)) {
            throw new InsightError(
                'UNSUPPORTED_DIMENSION',
                `Report Source "${sourceId}" does not support dimension "${dimension}"`,
            )
        }
    }
    for (const field of query.filters ? filterFields(query.filters) : []) {
        if (!dimensions.has(field) && !metrics.has(field)) {
            throw new InsightError(
                'UNSUPPORTED_DIMENSION',
                `Report Source "${sourceId}" does not support filter field "${field}"`,
            )
        }
    }
    if (query.limit !== undefined && (!Number.isInteger(query.limit) || query.limit <= 0)) {
        throw new InsightError('INVALID_QUERY', 'Query limit must be a positive integer')
    }
    if (query.range) normalizeTimeRange(query.range)
}
