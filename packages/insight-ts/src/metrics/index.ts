import { InsightError } from '../core/errors.ts'
import { normalizeTimeRange, normalizeTimestamp, type TimeRange } from '../core/time.ts'
import type {
    AdapterExecutionContext,
    CapabilityAdapterDefinition,
    CapabilityContract,
    CapabilityContribution,
    CapabilitySchema,
    HistoryFidelityBand,
    HistoryMaterializer,
    QueryQuality,
} from '../core/types.ts'

export { normalizeTimeRange }
export type { TimeRange }
export type { HistoryFidelity, HistoryFidelityBand, HistoryTransformation } from '../core/types.ts'

export type Grain = 'minute' | 'hour' | 'day' | 'week' | 'month' | 'year'
export type DimensionValue = boolean | number | string | null
export type DimensionValueType = 'boolean' | 'date' | 'datetime' | 'number' | 'string'

export type MetricAggregation =
    | { kind: 'sum' }
    | { kind: 'count' }
    | { kind: 'unique' }
    | { kind: 'approx-unique' }
    | { kind: 'mean' }
    | { kind: 'median' }
    | { kind: 'min' }
    | { kind: 'max' }
    | { kind: 'last' }
    | { kind: 'percentile'; quantile: number }
    | { denominator: string; kind: 'ratio'; numerator: string }
    | { id?: string; kind: 'provider-defined' }

export type MetricRollup = 'additive' | 'derived' | 'non-additive' | 'provider-defined'

export interface MetricDefinition {
    aggregation?: MetricAggregation
    label?: string
    rollup?: MetricRollup
    unit?: string
}

export type MetricDefinitions = Readonly<Record<string, MetricDefinition>>

export type WhereOperator =
    | 'eq'
    | 'ne'
    | 'gt'
    | 'gte'
    | 'lt'
    | 'lte'
    | 'in'
    | 'notIn'
    | 'contains'
    | 'notContains'
    | 'matches'
    | 'isNull'
    | 'isNotNull'

export interface DimensionDefinition<
    TType extends DimensionValueType = DimensionValueType,
    TOperator extends WhereOperator = WhereOperator,
> {
    label?: string
    operators?: readonly TOperator[]
    type: TType
}

export type DimensionInput = DimensionDefinition | DimensionValueType
export type DimensionDefinitions = Readonly<Record<string, DimensionInput>>

type ValueOfType<TType> = TType extends 'boolean'
    ? boolean
    : TType extends 'number'
      ? number
      : string

type DimensionType<TDefinition> = TDefinition extends DimensionValueType
    ? TDefinition
    : TDefinition extends DimensionDefinition<infer TType>
      ? TType
      : never

type DefaultOperator<TType extends DimensionValueType> =
    | 'eq'
    | 'ne'
    | 'in'
    | 'notIn'
    | 'isNull'
    | 'isNotNull'
    | (TType extends 'string' ? 'contains' | 'notContains' | 'matches' : never)
    | (TType extends 'number' | 'date' | 'datetime' ? 'gt' | 'gte' | 'lt' | 'lte' : never)

type OperatorOf<TDefinition> = TDefinition extends {
    operators: readonly (infer TOperator extends WhereOperator)[]
}
    ? TOperator
    : DefaultOperator<DimensionType<TDefinition>>

type OperatorValue<TOperator extends WhereOperator, TValue> = TOperator extends 'in' | 'notIn'
    ? readonly TValue[]
    : TOperator extends 'isNull' | 'isNotNull'
      ? true
      : TValue

type FieldCondition<TDefinition> =
    | ('eq' extends OperatorOf<TDefinition> ? ValueOfType<DimensionType<TDefinition>> : never)
    | {
          readonly [TOperator in OperatorOf<TDefinition>]?: OperatorValue<
              TOperator,
              ValueOfType<DimensionType<TDefinition>>
          >
      }

export type Where<TDimensions extends DimensionDefinitions> = {
    readonly [TField in keyof TDimensions]?: FieldCondition<TDimensions[TField]>
} & {
    readonly AND?: readonly Where<TDimensions>[]
    readonly NOT?: Where<TDimensions>
    readonly OR?: readonly Where<TDimensions>[]
}

export type CanonicalWhere =
    | {
          field: string
          operator: WhereOperator
          value?: DimensionValue | readonly Exclude<DimensionValue, null>[]
      }
    | { filters: readonly CanonicalWhere[]; operator: 'and' | 'or' }
    | { filter: CanonicalWhere; operator: 'not' }

export type MetricValues<TMetric extends string = string> = Readonly<Record<TMetric, number | null>>
export type DimensionValues<TDimension extends string = string> = Readonly<
    Record<TDimension, DimensionValue>
>

export interface MetricPoint<TMetric extends string = string, TDimension extends string = string> {
    dimensions?: Partial<DimensionValues<TDimension>>
    time?: string
    values: MetricValues<TMetric>
}

export interface MetricData<TMetric extends string = string, TDimension extends string = string> {
    readonly points?: readonly MetricPoint<TMetric, TDimension>[]
    readonly values: MetricValues<TMetric>
}

export interface MetricQuery<
    TMetrics extends MetricDefinitions = MetricDefinitions,
    TDimensions extends DimensionDefinitions = DimensionDefinitions,
> {
    dimensions?: readonly Extract<keyof TDimensions, string>[]
    limit?: number
    metrics: readonly Extract<keyof TMetrics, string>[]
    time: TimeRange & { grain?: Grain }
    timezone?: string
    where?: Where<TDimensions>
}

export interface NormalizedMetricQuery {
    dimensions: readonly string[]
    grain: Grain | 'auto'
    limit?: number
    metrics: readonly string[]
    time: TimeRange
    timezone: string
    where?: CanonicalWhere
}

export type MetricAdapterPoint = MetricPoint

export interface MetricAdapterOutput {
    meta?: MetricMeta
    points?: readonly MetricAdapterPoint[]
    quality?: QueryQuality
    values: MetricValues
}

export interface MetricMeta {
    fidelity?: readonly HistoryFidelityBand[]
    freshness?: {
        completeThrough?: string
        incompleteFrom?: string
    }
    temporal?: {
        bucketTimezone?: string
        grain?: Grain
        sourceTimezone?: string
    }
}

interface MetricCaptureOptions {
    dimensions?: readonly string[]
    grain: Grain
    metrics?: readonly string[]
}

interface CanonicalMetricQueryInput {
    limit?: number
    time: TimeRange & { grain?: Grain }
    timezone?: string
    where?: Readonly<Record<string, unknown>>
}

type MetricCapabilitySchema<
    TMetrics extends MetricDefinitions,
    TDimensions extends DimensionDefinitions,
> = CapabilitySchema<
    CanonicalMetricQueryInput,
    MetricData,
    MetricMeta,
    {
        dimensions: Extract<keyof TDimensions, string>
        metrics: Extract<keyof TMetrics, string>
    },
    'metrics'
>

type MetricContract = CapabilityContract<'metrics', NormalizedMetricQuery>

export interface MetricAdapterDefinition<
    TMetrics extends MetricDefinitions = MetricDefinitions,
    TDimensions extends DimensionDefinitions = DimensionDefinitions,
> extends CapabilityAdapterDefinition<
    'metrics',
    MetricCapabilitySchema<TMetrics, TDimensions>,
    MetricQuery<TMetrics, TDimensions>,
    NormalizedMetricQuery,
    MetricData,
    MetricMeta
> {
    dimensions: DimensionDefinitions
    metricAdapter: true
    metrics: TMetrics
}

export interface MetricAdapterOptions<
    TMetrics extends MetricDefinitions,
    TDimensions extends DimensionDefinitions,
> {
    dimensions?: TDimensions
    execute(
        query: NormalizedMetricQuery,
        context: AdapterExecutionContext,
    ): Promise<MetricAdapterOutput> | MetricAdapterOutput
    history?: MetricCaptureOptions
    metrics: TMetrics
}

export const defineMetricAdapter = <
    const TMetrics extends MetricDefinitions,
    const TDimensions extends DimensionDefinitions = Record<never, never>,
>(
    options: MetricAdapterOptions<TMetrics, TDimensions>,
): MetricAdapterDefinition<TMetrics, TDimensions> => {
    validateMetricDefinitions(options.metrics)
    const dimensions = options.dimensions ?? {}
    const materialize = metricHistoryMaterializer(
        options.metrics,
        dimensions,
        options.history ?? { grain: 'day' },
    )
    const adapter: MetricAdapterDefinition<TMetrics, TDimensions> = {
        contract: metricContract,
        dimensions,
        async execute(query: NormalizedMetricQuery, context: AdapterExecutionContext) {
            const output = await options.execute(query, context)
            return {
                data: metricData(query, output),
                ...(output.meta ? { meta: output.meta } : {}),
                ...(output.quality ? { quality: output.quality } : {}),
            }
        },
        key: (query: NormalizedMetricQuery) => JSON.stringify(query),
        materialize,
        metricAdapter: true as const,
        metrics: options.metrics,
        normalize: (input: MetricQuery<TMetrics, TDimensions>) =>
            normalizeMetricQuery(input, options.metrics, dimensions),
    }
    return adapter
}

const normalizeMetricQuery = (
    input: unknown,
    metricDefinitions: MetricDefinitions,
    dimensionDefinitions: DimensionDefinitions,
): NormalizedMetricQuery => {
    const query = requireRecord(input, 'Metric query')
    const metrics = stringArray(query.metrics, 'metrics')
    const dimensions =
        query.dimensions === undefined ? [] : stringArray(query.dimensions, 'dimensions')
    validateSelection(metricDefinitions, dimensionDefinitions, metrics, dimensions)
    const time = requireRecord(query.time, 'time')
    if (typeof time.from !== 'string' || typeof time.to !== 'string') {
        throw new InsightError('INVALID_QUERY', 'Time from and to must be ISO strings')
    }
    const inputGrain = time.grain
    if (inputGrain !== undefined && !isGrain(inputGrain)) {
        throw new InsightError(
            'INVALID_QUERY',
            `Unsupported time grain: ${JSON.stringify(inputGrain)}`,
        )
    }
    const grain = inputGrain ?? 'auto'
    if (query.limit !== undefined && (!Number.isInteger(query.limit) || Number(query.limit) <= 0)) {
        throw new InsightError('INVALID_QUERY', 'Query limit must be a positive integer')
    }
    if (query.timezone !== undefined && typeof query.timezone !== 'string') {
        throw new InsightError('INVALID_QUERY', 'Timezone must be a string')
    }
    const where =
        query.where === undefined ? undefined : normalizeWhere(query.where, dimensionDefinitions)
    return {
        dimensions,
        grain,
        ...(typeof query.limit === 'number' ? { limit: query.limit } : {}),
        metrics,
        time: normalizeTimeRange({ from: time.from, to: time.to }),
        timezone: typeof query.timezone === 'string' ? query.timezone : 'UTC',
        ...(where ? { where } : {}),
    }
}

const validateSelection = (
    metrics: MetricDefinitions,
    dimensions: DimensionDefinitions,
    selectedMetrics: readonly string[],
    selectedDimensions: readonly string[],
): void => {
    if (selectedMetrics.length === 0) {
        throw new InsightError('INVALID_QUERY', 'At least one metric is required')
    }
    for (const metric of selectedMetrics) {
        if (!Object.hasOwn(metrics, metric)) {
            throw new InsightError('UNSUPPORTED_METRIC', `Unsupported metric: ${metric}`)
        }
    }
    for (const dimension of selectedDimensions) {
        if (!Object.hasOwn(dimensions, dimension)) {
            throw new InsightError('UNSUPPORTED_DIMENSION', `Unsupported dimension: ${dimension}`)
        }
    }
}

const validateMetricDefinitions = (definitions: MetricDefinitions): void => {
    for (const [metric, definition] of Object.entries(definitions)) {
        const aggregation = definition.aggregation
        if (
            aggregation?.kind === 'percentile' &&
            (!(aggregation.quantile > 0) || aggregation.quantile >= 1)
        ) {
            throw new TypeError(`Metric "${metric}" percentile quantile must be in (0, 1)`)
        }
        if (
            aggregation?.kind === 'ratio' &&
            (!Object.hasOwn(definitions, aggregation.numerator) ||
                !Object.hasOwn(definitions, aggregation.denominator))
        ) {
            throw new TypeError(`Metric "${metric}" ratio inputs must be declared metrics`)
        }
    }
}

const normalizeWhere = (
    input: unknown,
    definitions: DimensionDefinitions,
): CanonicalWhere | undefined => {
    const where = requireRecord(input, 'where')
    const filters: CanonicalWhere[] = []
    for (const field of Object.keys(where).toSorted()) {
        const value = where[field]
        if (field === 'AND' || field === 'OR') {
            if (!Array.isArray(value) || value.length === 0) {
                throw new InsightError('INVALID_QUERY', `where.${field} must be a non-empty array`)
            }
            const children = value.map((child) => normalizeWhere(child, definitions))
            filters.push(combine(field === 'AND' ? 'and' : 'or', children))
            continue
        }
        if (field === 'NOT') {
            const child = normalizeWhere(value, definitions)
            if (!child) throw new InsightError('INVALID_QUERY', 'where.NOT cannot be empty')
            filters.push({ filter: child, operator: 'not' })
            continue
        }
        const definition = definitions[field]
        if (!definition) {
            throw new InsightError('UNSUPPORTED_DIMENSION', `Unsupported where field: ${field}`)
        }
        filters.push(...fieldFilters(field, value, definition))
    }
    return filters.length === 0 ? undefined : combine('and', filters)
}

const fieldFilters = (
    field: string,
    input: unknown,
    definition: DimensionInput,
): CanonicalWhere[] => {
    const type = typeof definition === 'string' ? definition : definition.type
    if (!isRecord(input)) {
        const value = normalizeOperatorValue('eq', input, type)
        if (value === undefined) {
            throw new InsightError('INVALID_QUERY', 'where eq requires a value')
        }
        return [{ field, operator: 'eq', value }]
    }
    const allowed = new Set(
        typeof definition === 'string' || !definition.operators
            ? defaultOperators(type)
            : definition.operators,
    )
    return Object.keys(input)
        .toSorted()
        .map((name) => {
            if (!isWhereOperator(name) || !allowed.has(name)) {
                throw new InsightError(
                    'INVALID_QUERY',
                    `where field "${field}" does not support operator "${name}"`,
                )
            }
            const value = input[name]
            const normalized = normalizeOperatorValue(name, value, type)
            return normalized === undefined
                ? { field, operator: name }
                : { field, operator: name, value: normalized }
        })
}

const defaultOperators = (type: DimensionValueType): readonly WhereOperator[] => [
    'eq',
    'ne',
    'in',
    'notIn',
    'isNull',
    'isNotNull',
    ...(type === 'string' ? (['contains', 'notContains', 'matches'] as const) : []),
    ...(['number', 'date', 'datetime'].includes(type) ? (['gt', 'gte', 'lt', 'lte'] as const) : []),
]

const normalizeOperatorValue = (
    operator: WhereOperator,
    value: unknown,
    type: DimensionValueType,
): DimensionValue | readonly Exclude<DimensionValue, null>[] | undefined => {
    if (operator === 'isNull' || operator === 'isNotNull') {
        if (value !== true) {
            throw new InsightError('INVALID_QUERY', `where operator "${operator}" requires true`)
        }
        return undefined
    }
    if (operator === 'in' || operator === 'notIn') {
        if (!Array.isArray(value) || value.length === 0) {
            throw new InsightError(
                'INVALID_QUERY',
                `where operator "${operator}" has an invalid value`,
            )
        }
        const values = value.flatMap((item) => (valueMatches(item, type) ? [item] : []))
        if (values.length !== value.length) {
            throw new InsightError(
                'INVALID_QUERY',
                `where operator "${operator}" has an invalid value`,
            )
        }
        return values
    }
    if (!valueMatches(value, type)) {
        throw new InsightError('INVALID_QUERY', `where operator "${operator}" has an invalid value`)
    }
    return value
}

const valueMatches = (
    value: unknown,
    type: DimensionValueType,
): value is Exclude<DimensionValue, null> =>
    type === 'boolean'
        ? typeof value === 'boolean'
        : type === 'number'
          ? typeof value === 'number' && Number.isFinite(value)
          : typeof value === 'string'

const combine = (
    operator: 'and' | 'or',
    input: readonly (CanonicalWhere | undefined)[],
): CanonicalWhere => {
    const filters = input
        .flatMap((filter) =>
            filter && 'filters' in filter && filter.operator === operator
                ? filter.filters
                : filter
                  ? [filter]
                  : [],
        )
        .toSorted((left, right) => JSON.stringify(left).localeCompare(JSON.stringify(right)))
    if (filters.length === 0) {
        throw new InsightError('INVALID_QUERY', `where ${operator.toUpperCase()} cannot be empty`)
    }
    return filters.length === 1 ? filters[0]! : { filters, operator }
}

const whereOperators = new Set<string>([
    'eq',
    'ne',
    'gt',
    'gte',
    'lt',
    'lte',
    'in',
    'notIn',
    'contains',
    'notContains',
    'matches',
    'isNull',
    'isNotNull',
])
const isWhereOperator = (value: string): value is WhereOperator => whereOperators.has(value)

const metricData = (query: NormalizedMetricQuery, output: MetricAdapterOutput): MetricData => {
    const points = (output.points ?? []).map((point) => ({
        ...(point.dimensions ? { dimensions: point.dimensions } : {}),
        ...(point.time ? { time: normalizeTimestamp(point.time, 'Metric point time') } : {}),
        values: selectedMetricValues(query.metrics, point.values, 'point'),
    }))
    return {
        ...(points.length > 0 ? { points } : {}),
        values: selectedMetricValues(query.metrics, output.values, 'value'),
    }
}

const selectedMetricValues = (
    metrics: readonly string[],
    values: MetricValues,
    location: 'point' | 'value',
): MetricValues =>
    Object.fromEntries(
        metrics.map((metric) => [
            metric,
            finiteOrNull(values[metric], `Metric "${metric}" ${location}`),
        ]),
    )

const grains = new Set<string>(['minute', 'hour', 'day', 'week', 'month', 'year'])
const isGrain = (value: unknown): value is Grain => typeof value === 'string' && grains.has(value)

const stringArray = (value: unknown, name: string): string[] => {
    if (!Array.isArray(value) || value.some((item) => typeof item !== 'string')) {
        throw new InsightError('INVALID_QUERY', `${name} must be a string array`)
    }
    return [...new Set(value)]
}

const finiteOrNull = (value: unknown, name: string): number | null => {
    if (value === null) return null
    if (typeof value !== 'number' || !Number.isFinite(value)) {
        throw new InsightError('INVALID_QUERY', `${name} must be finite or null`)
    }
    return value
}

const requireRecord = (value: unknown, name: string): Record<string, unknown> => {
    if (!isRecord(value)) throw new InsightError('INVALID_QUERY', `${name} must be an object`)
    return value
}

const isRecord = (value: unknown): value is Record<string, unknown> =>
    typeof value === 'object' && value !== null && !Array.isArray(value)

const metricContract: MetricContract = {
    key: (query) => JSON.stringify(query),
    merge(query, contributions) {
        const rows = new Map<
            string,
            {
                dimensions?: Partial<DimensionValues>
                time?: string
                values: Record<string, number | null>
            }
        >()
        const values: Record<string, number | null> = Object.fromEntries(
            query.metrics.map((metric) => [metric, null]),
        )
        for (const contribution of contributions) {
            const data = requireMetricData(contribution.result.data)
            for (const metric of query.metrics) {
                if (Object.hasOwn(data.values, metric)) values[metric] = data.values[metric] ?? null
            }
            for (const point of data.points ?? []) {
                const key = metricPointKey(point)
                const row = rows.get(key) ?? {
                    ...(point.dimensions ? { dimensions: point.dimensions } : {}),
                    ...(point.time ? { time: point.time } : {}),
                    values: Object.fromEntries(query.metrics.map((metric) => [metric, null])),
                }
                for (const metric of query.metrics) {
                    if (Object.hasOwn(point.values, metric)) {
                        row.values[metric] = point.values[metric] ?? null
                    }
                }
                rows.set(key, row)
            }
        }
        const points = [...rows.values()].toSorted((left, right) =>
            metricPointKey(left).localeCompare(metricPointKey(right)),
        )
        return {
            contributions: contributions.map(({ result }) => ({
                fields: Object.keys(requireMetricData(result.data).values),
                ...(result.quality ? { quality: result.quality } : {}),
            })),
            data: { ...(points.length > 0 ? { points } : {}), values },
            ...mergeMetricMeta(contributions),
        }
    },
    name: 'metrics',
    normalize(input, adapters) {
        const metrics = metricAdapters(adapters)
        const query = requireRecord(input, 'Metric query')
        const selected = stringArray(query.metrics, 'metrics')
        const owners = new Map<string, MetricAdapterDefinition>()
        for (const adapter of metrics) {
            for (const metric of Object.keys(adapter.metrics)) owners.set(metric, adapter)
        }
        const contributing = new Set<MetricAdapterDefinition>()
        for (const metric of selected) {
            const owner = owners.get(metric)
            if (!owner) {
                throw new InsightError('UNSUPPORTED_METRIC', `Unsupported metric: ${metric}`)
            }
            contributing.add(owner)
        }
        return normalizeMetricQuery(
            input,
            Object.fromEntries(metrics.flatMap((adapter) => Object.entries(adapter.metrics))),
            compatibleDimensions([...contributing]),
        )
    },
    plan(query, adapter) {
        if (!isMetricAdapter(adapter)) return undefined
        const metrics = query.metrics.filter((metric) => Object.hasOwn(adapter.metrics, metric))
        return metrics.length === 0 ? undefined : { ...query, metrics }
    },
    validate(adapters) {
        const owners = new Map<string, MetricAdapterDefinition>()
        for (const adapter of metricAdapters(adapters)) {
            for (const metric of Object.keys(adapter.metrics)) {
                if (owners.has(metric)) {
                    throw new InsightError(
                        'INVALID_QUERY',
                        `Metric "${metric}" has more than one adapter in the Scope`,
                    )
                }
                owners.set(metric, adapter)
            }
        }
    },
}

const metricAdapters = (adapters: readonly object[]): MetricAdapterDefinition[] => {
    const metrics = adapters.filter(isMetricAdapter)
    if (metrics.length !== adapters.length) {
        throw new InsightError('INVALID_QUERY', 'Metrics contract received an invalid adapter')
    }
    return metrics
}

const isMetricAdapter = (value: object): value is MetricAdapterDefinition =>
    isRecord(value) &&
    value.metricAdapter === true &&
    isRecord(value.metrics) &&
    isRecord(value.dimensions)

const compatibleDimensions = (
    adapters: readonly MetricAdapterDefinition[],
): DimensionDefinitions => {
    if (adapters.length === 0) return {}
    const dimensions: Record<string, DimensionInput> = {}
    for (const [field, definition] of Object.entries(adapters[0]!.dimensions)) {
        const type = dimensionType(definition)
        const operators = defaultedOperators(definition)
        if (
            adapters.slice(1).every((adapter) => {
                const candidate = adapter.dimensions[field]
                return candidate !== undefined && dimensionType(candidate) === type
            })
        ) {
            const common = [...operators].filter((operator) =>
                adapters
                    .slice(1)
                    .every((adapter) =>
                        defaultedOperators(adapter.dimensions[field]!).has(operator),
                    ),
            )
            dimensions[field] = { operators: common, type }
        }
    }
    return dimensions
}

const dimensionType = (definition: DimensionInput): DimensionValueType =>
    typeof definition === 'string' ? definition : definition.type

const defaultedOperators = (definition: DimensionInput): Set<WhereOperator> =>
    new Set(
        typeof definition === 'string' || !definition.operators
            ? defaultOperators(dimensionType(definition))
            : definition.operators,
    )

const requireMetricData = (value: unknown): MetricData => {
    if (!isRecord(value) || !isRecord(value.values)) {
        throw new InsightError('INVALID_QUERY', 'Metric adapter returned invalid data')
    }
    const points = value.points
    if (points !== undefined && !Array.isArray(points)) {
        throw new InsightError('INVALID_QUERY', 'Metric adapter returned invalid points')
    }
    // Metric adapters construct this value at the canonical boundary.
    // eslint-disable-next-line typescript/no-unsafe-type-assertion
    return value as unknown as MetricData
}

const metricHistoryMaterializer = (
    definitions: MetricDefinitions,
    dimensions: DimensionDefinitions,
    capture: MetricCaptureOptions,
): HistoryMaterializer<NormalizedMetricQuery, MetricData, MetricMeta> => {
    const metrics = capture.metrics ?? Object.keys(definitions)
    const selectedDimensions = capture.dimensions ?? []
    for (const metric of metrics) {
        if (!Object.hasOwn(definitions, metric)) {
            throw new TypeError(`Unknown History metric "${metric}"`)
        }
    }
    for (const dimension of selectedDimensions) {
        if (!Object.hasOwn(dimensions, dimension)) {
            throw new TypeError(`Unknown History dimension "${dimension}"`)
        }
    }
    return {
        capture: (range) => ({
            dimensions: selectedDimensions,
            grain: capture.grain,
            metrics,
            time: normalizeTimeRange(range),
            timezone: 'UTC',
        }),
        itemId: () => 'metrics',
        items: (data) => [requireMetricData(data)],
        materialize: (query, items) => ({
            data: materializeMetricData(
                mergeStoredMetricData(items.map((item) => requireMetricData(item))),
                definitions,
                query,
            ),
            meta: {
                temporal: {
                    ...(query.grain === 'auto' ? {} : { grain: query.grain }),
                    ...(query.timezone ? { bucketTimezone: query.timezone } : {}),
                },
            },
        }),
        range: (query) =>
            query.where === undefined &&
            query.metrics.every((metric) => metrics.includes(metric)) &&
            query.dimensions.every((dimension) => selectedDimensions.includes(dimension))
                ? query.time
                : undefined,
        read: 'all',
        sortKey: () => 'metrics',
    }
}

const mergeStoredMetricData = (values: readonly MetricData[]): MetricData => {
    const points = values.flatMap((value) => value.points ?? [])
    return {
        ...(points.length > 0 ? { points } : {}),
        values: Object.assign({}, ...values.map((value) => value.values)),
    }
}

const materializeMetricData = (
    data: MetricData,
    definitions: MetricDefinitions,
    query: NormalizedMetricQuery,
): MetricData => {
    const resolve = (metric: string, points: readonly MetricPoint[]): number | null => {
        const definition = definitions[metric]
        if (!definition) {
            throw new InsightError('HISTORY_CORRUPT', `Unknown stored metric "${metric}"`)
        }
        if (definition.aggregation?.kind === 'ratio') {
            return metricRatio(
                resolve(definition.aggregation.numerator, points),
                resolve(definition.aggregation.denominator, points),
            )
        }
        return aggregateStoredMetric(
            points.map((point) => point.values[metric] ?? null),
            definition,
            metric,
        )
    }
    const groups = new Map<string, MetricPoint[]>()
    for (const point of data.points ?? []) {
        if (point.time && (point.time < query.time.from || point.time >= query.time.to)) continue
        const normalized: MetricPoint = {
            ...(query.dimensions.length > 0
                ? {
                      dimensions: Object.fromEntries(
                          query.dimensions.map((dimension) => [
                              dimension,
                              point.dimensions?.[dimension] ?? null,
                          ]),
                      ),
                  }
                : {}),
            ...(query.grain === 'auto' || !point.time
                ? {}
                : { time: metricBucketStart(point.time, query.grain) }),
            values: point.values,
        }
        const key = metricPointKey(normalized)
        const group = groups.get(key) ?? []
        group.push(normalized)
        groups.set(key, group)
    }
    const points = [...groups.values()]
        .map((group) => ({
            ...(group[0]?.dimensions ? { dimensions: group[0].dimensions } : {}),
            ...(group[0]?.time ? { time: group[0].time } : {}),
            values: Object.fromEntries(
                query.metrics.map((metric) => [metric, resolve(metric, group)]),
            ),
        }))
        .toSorted((left, right) => metricPointKey(left).localeCompare(metricPointKey(right)))
    const limited = query.limit ? points.slice(0, query.limit) : points
    const scalar = (metric: string): number | null => {
        const definition = definitions[metric]
        if (!definition) {
            throw new InsightError('HISTORY_CORRUPT', `Unknown stored metric "${metric}"`)
        }
        return definition.aggregation?.kind === 'ratio'
            ? metricRatio(
                  scalar(definition.aggregation.numerator),
                  scalar(definition.aggregation.denominator),
              )
            : (data.values[metric] ?? null)
    }
    return {
        ...(limited.length > 0 ? { points: limited } : {}),
        values: Object.fromEntries(
            query.metrics.map((metric) => [
                metric,
                data.points?.length ? resolve(metric, data.points) : scalar(metric),
            ]),
        ),
    }
}

const aggregateStoredMetric = (
    values: readonly (number | null)[],
    definition: MetricDefinition,
    metric: string,
): number | null => {
    const present = values.filter((value): value is number => value !== null)
    if (definition.rollup === 'additive') {
        return present.reduce((total, value) => total + value, 0)
    }
    if (definition.aggregation?.kind === 'last') return values.at(-1) ?? null
    if (values.length <= 1) return values[0] ?? null
    const reason =
        definition.aggregation?.kind === 'percentile'
            ? 'percentile'
            : (definition.aggregation?.kind ?? definition.rollup ?? 'unspecified')
    throw new InsightError(
        'UNSAFE_ROLLUP',
        `Metric "${metric}" cannot roll up ${reason} values safely`,
    )
}

const metricRatio = (
    numerator: number | null | undefined,
    denominator: number | null | undefined,
) =>
    numerator === null || numerator === undefined || !denominator ? null : numerator / denominator

const metricBucketStart = (value: string, grain: Grain): string => {
    const date = new Date(value)
    if (!Number.isFinite(date.valueOf())) {
        throw new InsightError('HISTORY_CORRUPT', `Invalid History timestamp: ${value}`)
    }
    if (grain === 'year') date.setUTCMonth(0, 1)
    if (grain === 'year' || grain === 'month') date.setUTCDate(1)
    if (grain === 'week') {
        const weekday = date.getUTCDay() || 7
        date.setUTCDate(date.getUTCDate() - weekday + 1)
    }
    if (['year', 'month', 'week', 'day'].includes(grain)) date.setUTCHours(0)
    if (grain !== 'minute') date.setUTCMinutes(0)
    date.setUTCSeconds(0, 0)
    return date.toISOString()
}

const metricPointKey = (point: { dimensions?: Partial<DimensionValues>; time?: string }): string =>
    `${point.time ?? ''}\0${JSON.stringify(
        Object.entries(point.dimensions ?? {}).toSorted(([left], [right]) =>
            left.localeCompare(right),
        ),
    )}`

const mergeMetricMeta = (
    contributions: readonly CapabilityContribution[],
): { meta?: MetricMeta } => {
    const metas = contributions.flatMap(({ result }) => (result.meta ? [result.meta] : []))
    if (metas.length === 0) return {}
    const first = JSON.stringify(metas[0])
    if (!metas.every((meta) => JSON.stringify(meta) === first)) return {}
    // Metric adapters are the only producers accepted by this contract.
    // eslint-disable-next-line typescript/no-unsafe-type-assertion
    return { meta: metas[0] as MetricMeta }
}
