import { InsightError } from './errors.ts'
import { normalizeTimeRange, validateSelection } from './query.ts'
import type {
    CreateInsightOptions,
    EventDefinition,
    EventDefinitions,
    Filter,
    FilterValue,
    HistoryRuntime,
    Grain,
    InsightClient,
    Report,
    ReportMeta,
    ReportOperation,
    ReportSourceDefinition,
    RuntimeReportSource,
} from './types.ts'

export const createInsight = <const TOptions extends CreateInsightOptions>(
    options: TOptions,
): InsightClient<TOptions> => {
    const now = options.now ?? (() => new Date())
    const sources = runtimeSources(options.providers)
    const byId = new Map(sources.map((source) => [source.id, source]))

    const invoke = async (
        source: RuntimeReportSource,
        operation: ReportOperation,
        input: unknown,
    ): Promise<Report> => {
        const query = requireRecord(input, `${operation} query`)
        const metrics = stringArray(query.metrics, 'metrics')
        const range = operation === 'snapshot' ? undefined : normalizeTimeRangeValue(query.range)
        const dimensions =
            operation === 'breakdown' ? stringArray(query.dimensions, 'dimensions') : []
        const filters = parseFilter(query.filters)
        validateSelection(source.id, source.definition, {
            dimensions,
            ...(filters ? { filters } : {}),
            ...(typeof query.limit === 'number' ? { limit: query.limit } : {}),
            metrics,
            ...(range ? { range } : {}),
        })
        const implementation = source.definition[operation]
        if (typeof implementation !== 'function') {
            throw new InsightError(
                'UNSUPPORTED_OPERATION',
                `Report Source "${source.id}" does not implement ${operation}()`,
            )
        }
        const normalized = {
            ...query,
            metrics,
            ...(range ? { range } : {}),
            ...(operation === 'series'
                ? {
                      grain:
                          query.grain ??
                          (source.definition.history?.mode === 'range'
                              ? source.definition.history.grain
                              : 'day'),
                  }
                : {}),
        }
        // The operation check above narrows the runtime call; result validation happens below.
        const result = await Reflect.apply(implementation, source.definition, [normalized])
        if (!isRecord(result)) {
            throw new InsightError(
                'INVALID_QUERY',
                `Report Source "${source.id}" returned an invalid ${operation} result`,
            )
        }
        return createReport(source.id, operation, normalized, result, metrics, now())
    }

    let history: HistoryRuntime | undefined
    if (options.history) history = options.history.attach({ invoke, now, sources })

    const execute = async (
        source: RuntimeReportSource,
        operation: ReportOperation,
        query: unknown,
    ): Promise<Report> => {
        if (history)
            return history.query(source, operation, query, () => invoke(source, operation, query))
        return invoke(source, operation, query)
    }

    const client = {
        ...(history ? { history } : {}),
        reports(sourceId: string) {
            const source = byId.get(sourceId)
            if (!source) {
                throw new InsightError('SOURCE_NOT_FOUND', `Unknown Report Source: ${sourceId}`)
            }
            const operations = operationNames(source.definition)
            if (source.definition.history?.mode === 'snapshot' && !operations.includes('series')) {
                operations.push('series')
            }
            return Object.fromEntries(
                operations.map((operation) => [
                    operation,
                    (query: unknown) => execute(source, operation, query),
                ]),
            )
        },
        sources: () =>
            sources.map(({ definition, id, provider }) => ({
                dimensions: Object.keys(definition.dimensions ?? {}),
                ...(definition.history ? { history: definition.history } : {}),
                id,
                metrics: Object.keys(definition.metrics),
                operations: operationNames(definition),
                provider,
            })),
        async track(name: string, properties?: Readonly<Record<string, unknown>>) {
            const events: EventDefinitions | undefined = options.events
            const definition = events && Object.hasOwn(events, name) ? events[name] : undefined
            const normalized = validateEvent(name, definition, properties)
            const destinations = options.providers.flatMap(({ events: destination }) =>
                destination ? [destination] : [],
            )
            if (destinations.length === 0) {
                throw new InsightError(
                    'CAPABILITY_UNAVAILABLE',
                    'No Provider event destination is configured',
                )
            }
            const event = {
                id: crypto.randomUUID(),
                name,
                origin: 'server' as const,
                properties: normalized,
                timestamp: now().toISOString(),
            }
            await Promise.all(destinations.map(async (destination) => destination.track(event)))
        },
    }
    // Runtime construction follows the generic Provider tuple checked by the public return type.
    // oxlint-disable-next-line typescript/no-unsafe-type-assertion
    return client as unknown as InsightClient<TOptions>
}

function runtimeSources(providers: CreateInsightOptions['providers']): RuntimeReportSource[] {
    const providerIds = providers.map(({ id }) => id)
    if (new Set(providerIds).size !== providerIds.length) {
        throw new InsightError('INVALID_QUERY', 'Provider ids must be unique')
    }
    const sources = providers.flatMap((provider) => {
        if (!provider.id || provider.id.includes('.')) {
            throw new InsightError(
                'INVALID_QUERY',
                'Provider ids must be non-empty and cannot contain a dot',
            )
        }
        return Object.entries(provider.reports ?? {}).map(([key, definition]) => {
            if (!key || key.includes('.')) {
                throw new InsightError(
                    'INVALID_QUERY',
                    'Report Source keys must be non-empty and cannot contain a dot',
                )
            }
            return { definition, id: `${provider.id}.${key}`, key, provider: provider.id }
        })
    })
    const ids = sources.map(({ id }) => id)
    if (new Set(ids).size !== ids.length) {
        throw new InsightError('INVALID_QUERY', 'Report Source ids must be unique')
    }
    return sources
}

const createReport = (
    source: string,
    operation: ReportOperation,
    query: Record<string, unknown>,
    result: Record<string, unknown>,
    metrics: readonly string[],
    queriedAt: Date,
): Report => {
    const resultTemporal = reportTemporal(result.temporal, source)
    const temporal: ReportMeta['temporal'] = {
        ...(isGrain(query.grain) ? { grain: query.grain } : {}),
        ...(typeof query.timezone === 'string' ? { bucketTimezone: query.timezone } : {}),
        ...resultTemporal,
    }
    const freshness = reportFreshness(result.freshness, source)
    const meta: ReportMeta = {
        ...(freshness ? { freshness } : {}),
        quality: reportQuality(result.quality, source),
        queriedAt: queriedAt.toISOString(),
        source,
        temporal,
    }
    if (operation === 'summary' || operation === 'snapshot') {
        const values = selectValues(result.values, metrics)
        return { kind: 'scalar', meta, values }
    }
    if (operation === 'series') {
        const points = result.points
        if (!Array.isArray(points)) return invalidResult(source, operation)
        return {
            kind: 'series',
            meta,
            points: points.map((value) => {
                const point = requireResultRecord(value, source, 'series point')
                const dimensions = reportDimensions(point.dimensions, source)
                return {
                    ...(dimensions ? { dimensions } : {}),
                    time: normalizeTimestamp(point.time, 'series point time'),
                    values: selectValues(point.values, metrics),
                }
            }),
        }
    }
    const rows = result.rows
    if (!Array.isArray(rows)) return invalidResult(source, operation)
    return {
        kind: 'table',
        meta,
        rows: rows.map((value) => {
            const row = requireResultRecord(value, source, 'breakdown row')
            const dimensions = reportDimensions(row.dimensions, source)
            if (!dimensions) return invalidResult(source, operation)
            return { dimensions, metrics: selectValues(row.metrics, metrics) }
        }),
    }
}

const selectValues = (
    values: unknown,
    metrics: readonly string[],
): Readonly<Record<string, number | null>> => {
    if (!isRecord(values))
        throw new InsightError('INVALID_QUERY', 'Report values must be an object')
    return Object.fromEntries(
        metrics.map((metric) => {
            const value = values[metric]
            if (value === null) return [metric, null]
            if (typeof value !== 'number' || !Number.isFinite(value)) {
                throw new InsightError('INVALID_QUERY', `Metric "${metric}" must be finite or null`)
            }
            return [metric, value]
        }),
    )
}

const operationNames = (source: ReportSourceDefinition): ReportOperation[] => {
    return (['summary', 'series', 'breakdown', 'snapshot'] as const).filter(
        (operation) => typeof source[operation] === 'function',
    )
}

const reportQuality = (value: unknown, source: string): ReportMeta['quality'] => {
    if (value === undefined) return {}
    const quality = requireResultRecord(value, source, 'quality metadata')
    const warnings = quality.warnings
    if (warnings !== undefined && !Array.isArray(warnings)) return invalidResult(source, 'quality')
    const parsedWarnings = warnings?.map((warningValue) => {
        const warning = requireResultRecord(warningValue, source, 'quality warning')
        if (typeof warning.code !== 'string' || typeof warning.message !== 'string') {
            return invalidResult(source, 'quality')
        }
        return { code: warning.code, message: warning.message }
    })
    const sampleRate = quality.sampleRate
    if (
        sampleRate !== undefined &&
        (typeof sampleRate !== 'number' || !Number.isFinite(sampleRate))
    ) {
        return invalidResult(source, 'quality')
    }
    return {
        ...(quality.approximate === true ? { approximate: true } : {}),
        ...(quality.partial === true ? { partial: true } : {}),
        ...(quality.sampled === true ? { sampled: true } : {}),
        ...(typeof sampleRate === 'number' ? { sampleRate } : {}),
        ...(quality.thresholded === true ? { thresholded: true } : {}),
        ...(parsedWarnings && parsedWarnings.length > 0 ? { warnings: parsedWarnings } : {}),
    }
}

const reportFreshness = (value: unknown, source: string): ReportMeta['freshness'] | undefined => {
    if (value === undefined) return undefined
    const freshness = requireResultRecord(value, source, 'freshness metadata')
    if (
        (freshness.completeThrough !== undefined &&
            typeof freshness.completeThrough !== 'string') ||
        (freshness.incompleteFrom !== undefined && typeof freshness.incompleteFrom !== 'string')
    ) {
        return invalidResult(source, 'freshness')
    }
    return {
        ...(typeof freshness.completeThrough === 'string'
            ? { completeThrough: freshness.completeThrough }
            : {}),
        ...(typeof freshness.incompleteFrom === 'string'
            ? { incompleteFrom: freshness.incompleteFrom }
            : {}),
    }
}

const reportTemporal = (value: unknown, source: string): ReportMeta['temporal'] => {
    if (value === undefined) return {}
    const temporal = requireResultRecord(value, source, 'temporal metadata')
    if (
        (temporal.grain !== undefined && !isGrain(temporal.grain)) ||
        (temporal.bucketTimezone !== undefined && typeof temporal.bucketTimezone !== 'string') ||
        (temporal.sourceTimezone !== undefined && typeof temporal.sourceTimezone !== 'string')
    ) {
        return invalidResult(source, 'temporal')
    }
    return {
        ...(isGrain(temporal.grain) ? { grain: temporal.grain } : {}),
        ...(typeof temporal.bucketTimezone === 'string'
            ? { bucketTimezone: temporal.bucketTimezone }
            : {}),
        ...(typeof temporal.sourceTimezone === 'string'
            ? { sourceTimezone: temporal.sourceTimezone }
            : {}),
    }
}

const reportDimensions = (
    value: unknown,
    source: string,
): Readonly<Record<string, FilterValue>> | undefined => {
    if (value === undefined) return undefined
    const dimensions = requireResultRecord(value, source, 'dimensions')
    const result: Record<string, FilterValue> = {}
    for (const [field, fieldValue] of Object.entries(dimensions)) {
        if (!isFilterValue(fieldValue)) return invalidResult(source, 'dimensions')
        result[field] = fieldValue
    }
    return result
}

const requireResultRecord = (
    value: unknown,
    source: string,
    name: string,
): Record<string, unknown> => {
    if (!isRecord(value)) return invalidResult(source, name)
    return value
}

function validateEvent(
    name: string,
    definition: EventDefinition | undefined,
    properties: unknown,
): Readonly<Record<string, unknown>> {
    if (!definition) throw new InsightError('INVALID_QUERY', `Unknown event: ${name}`)
    if (!definition.properties) {
        if (
            properties !== undefined &&
            (!isRecord(properties) || Object.keys(properties).length > 0)
        ) {
            throw new InsightError('INVALID_QUERY', `Event "${name}" does not accept properties`)
        }
        return {}
    }
    if (!isRecord(properties)) {
        throw new InsightError('INVALID_QUERY', `Event "${name}" requires properties`)
    }
    for (const property of Object.keys(properties)) {
        if (!Object.hasOwn(definition.properties, property)) {
            throw new InsightError(
                'INVALID_QUERY',
                `Unknown property "${property}" for event "${name}"`,
            )
        }
    }
    for (const [property, expected] of Object.entries(definition.properties)) {
        if (!Object.hasOwn(properties, property)) {
            throw new InsightError(
                'INVALID_QUERY',
                `Missing property "${property}" for event "${name}"`,
            )
        }
        const value = properties[property]
        const valid = Array.isArray(expected)
            ? typeof value === 'string' && expected.includes(value)
            : expected === 'number'
              ? typeof value === 'number' && Number.isFinite(value)
              : typeof value === expected
        if (!valid) {
            throw new InsightError(
                'INVALID_QUERY',
                `Invalid property "${property}" for event "${name}"`,
            )
        }
    }
    return Object.fromEntries(Object.entries(properties))
}

function normalizeTimeRangeValue(value: unknown) {
    const range = requireRecord(value, 'range')
    if (typeof range.from !== 'string' || typeof range.to !== 'string') {
        throw new InsightError('INVALID_QUERY', 'Range from and to must be ISO strings')
    }
    return normalizeTimeRange({ from: range.from, to: range.to })
}

function normalizeTimestamp(value: unknown, name: string): string {
    if (typeof value !== 'string' || !Number.isFinite(new Date(value).valueOf())) {
        throw new InsightError('INVALID_QUERY', `${name} must be an ISO timestamp`)
    }
    return new Date(value).toISOString()
}

function stringArray(value: unknown, name: string): string[] {
    if (!Array.isArray(value) || value.some((item) => typeof item !== 'string')) {
        throw new InsightError('INVALID_QUERY', `${name} must be a string array`)
    }
    return [...new Set(value)]
}

const filterOperators = new Set([
    'eq',
    'neq',
    'in',
    'not-in',
    'contains',
    'matches',
    'gt',
    'gte',
    'lt',
    'lte',
])
const grains = new Set(['minute', 'hour', 'day', 'week', 'month', 'year'])

type FilterOperator = Extract<Filter, { field: string }>['operator']

const parseFilter = (value: unknown): Filter | undefined => {
    if (value === undefined) return undefined
    if (!isRecord(value)) throw new InsightError('INVALID_QUERY', 'Filter must be an object')
    if ('field' in value) {
        if (
            typeof value.field !== 'string' ||
            !isFilterOperator(value.operator) ||
            (!isFilterValue(value.value) &&
                (!Array.isArray(value.value) || !value.value.every(isFilterValue)))
        ) {
            throw new InsightError('INVALID_QUERY', 'Filter field or operator is invalid')
        }
        return { field: value.field, operator: value.operator, value: value.value }
    }
    if ('not' in value) {
        const parsed = parseFilter(value.not)
        if (!parsed) throw new InsightError('INVALID_QUERY', 'Filter not value is invalid')
        return { not: parsed }
    }
    const key = 'and' in value ? 'and' : 'or' in value ? 'or' : undefined
    if (!key || !Array.isArray(value[key])) {
        throw new InsightError('INVALID_QUERY', 'Filter group is invalid')
    }
    const children: Filter[] = []
    for (const child of value[key]) {
        const parsed = parseFilter(child)
        if (!parsed) throw new InsightError('INVALID_QUERY', 'Filter group value is invalid')
        children.push(parsed)
    }
    return key === 'and' ? { and: children } : { or: children }
}

const isFilterOperator = (value: unknown): value is FilterOperator =>
    typeof value === 'string' && filterOperators.has(value)

const isFilterValue = (value: unknown): value is FilterValue =>
    value === null ||
    typeof value === 'boolean' ||
    typeof value === 'number' ||
    typeof value === 'string'

const isGrain = (value: unknown): value is Grain => typeof value === 'string' && grains.has(value)

function requireRecord(value: unknown, name: string): Record<string, unknown> {
    if (!isRecord(value)) throw new InsightError('INVALID_QUERY', `${name} must be an object`)
    return value
}

function isRecord(value: unknown): value is Record<string, unknown> {
    return typeof value === 'object' && value !== null && !Array.isArray(value)
}

function invalidResult(source: string, operation: string): never {
    throw new InsightError(
        'INVALID_QUERY',
        `Report Source "${source}" returned an invalid ${operation} result`,
    )
}
