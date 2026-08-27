import { AnalyticsError } from './errors'
import type {
    AnalyticsFilter,
    AnalyticsInternalSource,
    AnalyticsNormalizedSourceDescriptor,
    AnalyticsQuery,
    AnalyticsRange,
    ResolvedAnalyticsQuery,
} from './types'

export function normalizeRange(range: AnalyticsRange): AnalyticsRange {
    const from = new Date(range.from)
    const to = new Date(range.to)
    if (!Number.isFinite(from.valueOf()) || !Number.isFinite(to.valueOf()) || from >= to) {
        throw new AnalyticsError(
            'INVALID_QUERY',
            'Query range must contain valid from and to timestamps with from before to',
        )
    }
    return { from: from.toISOString(), to: to.toISOString() }
}

function filterDimensions(filter: AnalyticsFilter): string[] {
    if ('dimension' in filter) return [filter.dimension]
    if ('not' in filter) return filterDimensions(filter.not)
    const filters = 'and' in filter ? filter.and : filter.or
    return filters.flatMap(filterDimensions)
}

function supports(source: AnalyticsNormalizedSourceDescriptor, query: AnalyticsQuery): boolean {
    const metrics = new Set(source.metrics.map(({ id }) => id))
    const dimensions = new Set(source.dimensions.map(({ id }) => id))
    return (
        query.metrics.every((metric) => metrics.has(metric)) &&
        [
            ...(query.dimensions ?? []),
            ...(query.filters ? filterDimensions(query.filters) : []),
        ].every((dimension) => dimensions.has(dimension))
    )
}

function validateSchema(source: AnalyticsNormalizedSourceDescriptor, query: AnalyticsQuery): void {
    const metrics = new Set(source.metrics.map(({ id }) => id))
    const dimensions = new Set(source.dimensions.map(({ id }) => id))

    for (const metric of query.metrics) {
        if (!metrics.has(metric)) {
            throw new AnalyticsError(
                'UNSUPPORTED_METRIC',
                `Source "${source.id}" does not support metric "${metric}"`,
            )
        }
    }
    for (const dimension of [
        ...(query.dimensions ?? []),
        ...(query.filters ? filterDimensions(query.filters) : []),
    ]) {
        if (!dimensions.has(dimension)) {
            throw new AnalyticsError(
                'UNSUPPORTED_DIMENSION',
                `Source "${source.id}" does not support dimension "${dimension}"`,
            )
        }
    }
}

export function resolveSource(
    sources: readonly AnalyticsInternalSource[],
    query: AnalyticsQuery,
    defaults: Readonly<Record<string, string>>,
): AnalyticsInternalSource {
    if (query.source) {
        const source = sources.find(({ source: descriptor }) => descriptor.id === query.source)
        if (!source) {
            throw new AnalyticsError(
                'SOURCE_NOT_FOUND',
                `Unknown analytics source: ${query.source}`,
            )
        }
        validateSchema(source.source, query)
        return source
    }

    const candidates = sources.filter(({ source }) => supports(source, query))
    const defaultCandidates = candidates.filter(
        ({ source }) => defaults[source.domain] === source.id,
    )
    const selected = defaultCandidates.length === 1 ? defaultCandidates[0] : candidates[0]
    if (candidates.length === 0 || !selected) {
        throw new AnalyticsError('SOURCE_NOT_FOUND', 'No analytics source supports this query')
    }
    if (candidates.length > 1 && defaultCandidates.length !== 1) {
        throw new AnalyticsError(
            'SOURCE_AMBIGUOUS',
            `Query matches multiple analytics sources: ${candidates
                .map(({ source }) => source.id)
                .join(', ')}`,
        )
    }
    validateSchema(selected.source, query)
    return selected
}

export function validateQuery(query: AnalyticsQuery): void {
    if (query.metrics.length === 0) {
        throw new AnalyticsError('INVALID_QUERY', 'Query must request at least one metric')
    }
    if (query.limit !== undefined && (!Number.isInteger(query.limit) || query.limit <= 0)) {
        throw new AnalyticsError('INVALID_QUERY', 'Query limit must be a positive integer')
    }
    normalizeRange(query.range)
}

export function resolveQuery(query: AnalyticsQuery, source: string): ResolvedAnalyticsQuery {
    validateQuery(query)
    return {
        ...(query.filters ? { filters: query.filters } : {}),
        ...(query.limit === undefined ? {} : { limit: query.limit }),
        dimensions: query.dimensions ?? [],
        grain: query.grain ?? 'auto',
        metrics: query.metrics,
        range: normalizeRange(query.range),
        source,
        timezone: query.timezone ?? 'UTC',
    }
}
