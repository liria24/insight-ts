import { AnalyticsError } from './errors.ts'
import type {
    AnalyticsAbsoluteRange,
    AnalyticsAdapter,
    AnalyticsDatasetDescriptor,
    AnalyticsFilter,
    AnalyticsQuery,
    ResolvedAnalyticsQuery,
} from './types.ts'

const durationPattern = /^(\d+)([hdwmy])$/
const durationMilliseconds = {
    d: 86_400_000,
    h: 3_600_000,
    m: 2_592_000_000,
    w: 604_800_000,
    y: 31_536_000_000,
} as const

function isDurationUnit(value: string | undefined): value is keyof typeof durationMilliseconds {
    return value === 'd' || value === 'h' || value === 'm' || value === 'w' || value === 'y'
}

export function resolveRange(range: AnalyticsQuery['range'], now: Date): AnalyticsAbsoluteRange {
    if (typeof range !== 'string') {
        const from = new Date(range.from)
        const to = new Date(range.to)
        if (!Number.isFinite(from.valueOf()) || !Number.isFinite(to.valueOf()) || from >= to) {
            throw new AnalyticsError(
                'INVALID_QUERY',
                'Query range must have valid from and to dates',
            )
        }
        return { from: from.toISOString(), to: to.toISOString() }
    }

    const match = durationPattern.exec(range)
    if (!match) {
        throw new AnalyticsError('INVALID_QUERY', `Invalid relative range: ${range}`)
    }
    const amount = Number(match[1])
    const unit = match[2]
    if (amount <= 0 || !isDurationUnit(unit)) {
        throw new AnalyticsError('INVALID_QUERY', 'Query range must be greater than zero')
    }
    return {
        from: new Date(now.valueOf() - amount * durationMilliseconds[unit]).toISOString(),
        to: now.toISOString(),
    }
}

function filterDimensions(filter: AnalyticsFilter): string[] {
    if ('dimension' in filter) return [filter.dimension]
    if ('not' in filter) return filterDimensions(filter.not)
    const filters = 'and' in filter ? filter.and : filter.or
    return filters.flatMap(filterDimensions)
}

function supports(dataset: AnalyticsDatasetDescriptor, query: AnalyticsQuery): boolean {
    const metrics = new Set(dataset.metrics.map(({ id }) => id))
    const dimensions = new Set(dataset.dimensions.map(({ id }) => id))
    return (
        query.metrics.every((metric) => metrics.has(metric)) &&
        [
            ...(query.dimensions ?? []),
            ...(query.filters ? filterDimensions(query.filters) : []),
        ].every((dimension) => dimensions.has(dimension))
    )
}

function validateSchema(dataset: AnalyticsDatasetDescriptor, query: AnalyticsQuery): void {
    const metrics = new Set(dataset.metrics.map(({ id }) => id))
    const dimensions = new Set(dataset.dimensions.map(({ id }) => id))

    for (const metric of query.metrics) {
        if (!metrics.has(metric)) {
            throw new AnalyticsError(
                'UNSUPPORTED_METRIC',
                `Dataset "${dataset.id}" does not support metric "${metric}"`,
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
                `Dataset "${dataset.id}" does not support dimension "${dimension}"`,
            )
        }
    }
}

export function resolveAdapter(
    adapters: readonly AnalyticsAdapter[],
    query: AnalyticsQuery,
    defaultSources: Readonly<Record<string, string>>,
): AnalyticsAdapter {
    if (query.source) {
        const adapter = adapters.find(({ dataset }) => dataset.id === query.source)
        if (!adapter) {
            throw new AnalyticsError(
                'SOURCE_NOT_FOUND',
                `Unknown analytics source: ${query.source}`,
            )
        }
        validateSchema(adapter.dataset, query)
        return adapter
    }

    const candidates = adapters.filter(({ dataset }) => supports(dataset, query))
    const defaultCandidates = candidates.filter(
        ({ dataset }) => defaultSources[dataset.domain] === dataset.id,
    )
    const selected = defaultCandidates.length === 1 ? defaultCandidates[0] : candidates[0]
    if (candidates.length === 0 || !selected) {
        throw new AnalyticsError('SOURCE_NOT_FOUND', 'No analytics source supports this query')
    }
    if (candidates.length > 1 && defaultCandidates.length !== 1) {
        throw new AnalyticsError(
            'SOURCE_AMBIGUOUS',
            `Query matches multiple analytics sources: ${candidates
                .map(({ dataset }) => dataset.id)
                .join(', ')}`,
        )
    }
    validateSchema(selected.dataset, query)
    return selected
}

export function validateQuery(query: AnalyticsQuery, now: Date): void {
    if (query.metrics.length === 0) {
        throw new AnalyticsError('INVALID_QUERY', 'Query must request at least one metric')
    }
    if (query.limit !== undefined && (!Number.isInteger(query.limit) || query.limit <= 0)) {
        throw new AnalyticsError('INVALID_QUERY', 'Query limit must be a positive integer')
    }
    resolveRange(query.range, now)
}

export function resolveQuery(
    query: AnalyticsQuery,
    source: string,
    now: Date,
): ResolvedAnalyticsQuery {
    validateQuery(query, now)
    return {
        ...(query.filters ? { filters: query.filters } : {}),
        ...(query.limit === undefined ? {} : { limit: query.limit }),
        dimensions: query.dimensions ?? [],
        grain: query.grain ?? 'auto',
        metrics: query.metrics,
        range: resolveRange(query.range, now),
        source,
        timezone: query.timezone ?? 'UTC',
    }
}
