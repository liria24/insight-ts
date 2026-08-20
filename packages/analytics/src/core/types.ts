import type { Storage } from 'unstorage'

export type BuiltinAnalyticsDomain = 'traffic' | 'search' | 'product' | 'experience' | 'state'

export type AnalyticsDomain = BuiltinAnalyticsDomain | (string & {})
export type AnalyticsDatasetRef = string
export type AnalyticsGrain = 'auto' | 'minute' | 'hour' | 'day' | 'week' | 'month' | 'year'

export interface AnalyticsAbsoluteRange {
    from: string
    to: string
}

export type AnalyticsDuration = `${number}${'h' | 'd' | 'w' | 'm' | 'y'}`
export type AnalyticsRange = AnalyticsAbsoluteRange | AnalyticsDuration

export type AnalyticsFilterValue = boolean | number | string | null

export type AnalyticsFilter =
    | {
          dimension: string
          operator:
              | 'eq'
              | 'neq'
              | 'in'
              | 'not-in'
              | 'contains'
              | 'matches'
              | 'gt'
              | 'gte'
              | 'lt'
              | 'lte'
          value: AnalyticsFilterValue | readonly AnalyticsFilterValue[]
      }
    | { and: readonly AnalyticsFilter[] }
    | { not: AnalyticsFilter }
    | { or: readonly AnalyticsFilter[] }

export interface AnalyticsQuery {
    dimensions?: readonly string[]
    filters?: AnalyticsFilter
    grain?: AnalyticsGrain
    limit?: number
    metrics: readonly string[]
    range: AnalyticsRange
    source?: AnalyticsDatasetRef
    timezone?: string
}

export interface ResolvedAnalyticsQuery {
    dimensions: readonly string[]
    filters?: AnalyticsFilter
    grain: AnalyticsGrain
    limit?: number
    metrics: readonly string[]
    range: AnalyticsAbsoluteRange
    source: AnalyticsDatasetRef
    timezone: string
}

export type AnalyticsMetricValueType =
    | 'integer'
    | 'number'
    | 'duration'
    | 'ratio'
    | 'currency'
    | 'position'
    | 'score'

export type AnalyticsMetricAggregation =
    | 'sum'
    | 'count'
    | 'unique'
    | 'approx-unique'
    | 'mean'
    | 'median'
    | 'min'
    | 'max'
    | 'ratio'
    | 'percentile'
    | 'last'
    | 'provider-defined'

export type AnalyticsMetricRollup = 'additive' | 'derived' | 'non-additive' | 'provider-defined'

export interface AnalyticsMetricDescriptor {
    aggregation: AnalyticsMetricAggregation
    derive?: {
        denominator: string
        numerator: string
        operation: 'ratio'
    }
    id: string
    label?: string
    rollup: AnalyticsMetricRollup
    valueType: AnalyticsMetricValueType
}

export interface AnalyticsDimensionDescriptor {
    id: string
    label?: string
    valueType?: 'boolean' | 'date' | 'datetime' | 'number' | 'string'
}

export interface AnalyticsArchiveMaterialization {
    dimensions?: readonly string[]
    grain?: Exclude<AnalyticsGrain, 'auto'>
    id: string
    metrics: readonly string[]
    start?: string
}

export interface AnalyticsDatasetDescriptor {
    archive?: readonly AnalyticsArchiveMaterialization[]
    dimensions: readonly AnalyticsDimensionDescriptor[]
    domain: AnalyticsDomain
    id: AnalyticsDatasetRef
    metrics: readonly AnalyticsMetricDescriptor[]
}

export interface AnalyticsWarning {
    code: string
    message: string
}

export interface AnalyticsReportQuality {
    approximate?: boolean
    imported?: boolean
    partial?: boolean
    sampled?: boolean
    sampleRate?: number
    thresholded?: boolean
    warnings?: readonly AnalyticsWarning[]
}

export interface AnalyticsReportMeta {
    freshness?: {
        completeThrough?: string
        incompleteFrom?: string
    }
    quality: AnalyticsReportQuality
    queriedAt: string
    source: AnalyticsDatasetRef
    temporal: {
        bucketTimezone?: string
        grain?: AnalyticsGrain
        sourceTimezone?: string
    }
}

export type AnalyticsMetricValues = Record<string, number | null>
export type AnalyticsDimensionValues = Record<string, AnalyticsFilterValue>

export interface AnalyticsScalarReport {
    kind: 'scalar'
    meta: AnalyticsReportMeta
    values: AnalyticsMetricValues
}

export interface AnalyticsSeriesPoint {
    time: string
    values: AnalyticsMetricValues
}

export interface AnalyticsSeriesReport {
    kind: 'series'
    meta: AnalyticsReportMeta
    points: readonly AnalyticsSeriesPoint[]
}

export interface AnalyticsTableRow {
    dimensions: AnalyticsDimensionValues
    metrics: AnalyticsMetricValues
}

export interface AnalyticsTableReport {
    kind: 'table'
    meta: AnalyticsReportMeta
    rows: readonly AnalyticsTableRow[]
}

export type AnalyticsReport = AnalyticsScalarReport | AnalyticsSeriesReport | AnalyticsTableReport

export interface AnalyticsAdapter {
    dataset: AnalyticsDatasetDescriptor
    query: (query: ResolvedAnalyticsQuery) => Promise<AnalyticsReport>
    validate?: (query: ResolvedAnalyticsQuery) => void
}

export interface AnalyticsEvent {
    context?: {
        spanId?: string
        traceId?: string
    }
    id: string
    name: string
    origin: 'client' | 'import' | 'server'
    properties: Readonly<Record<string, unknown>>
    timestamp: string
}

export interface AnalyticsEventSink {
    track: (event: AnalyticsEvent) => Promise<void> | void
}

export interface AnalyticsAdapterBundle {
    adapters: readonly AnalyticsAdapter[]
    eventSink?: AnalyticsEventSink
}

export type AnalyticsAdapterInput = AnalyticsAdapter | AnalyticsAdapterBundle

export type AnalyticsEventProperty = 'boolean' | 'number' | 'string' | readonly string[]

export interface AnalyticsEventDefinition {
    properties?: Readonly<Record<string, AnalyticsEventProperty>>
}

export type AnalyticsEventDefinitions = Readonly<Record<string, AnalyticsEventDefinition>>

export type AnalyticsStateDimensionValue = boolean | number | string

export interface AnalyticsStateMetricDefinition {
    dimensions?: Readonly<Record<string, readonly AnalyticsStateDimensionValue[]>>
    label?: string
}

export type AnalyticsStateMetricDefinitions = Readonly<
    Record<string, AnalyticsStateMetricDefinition>
>

type AnalyticsStateDimensionRow<
    TDimensions extends Readonly<Record<string, readonly AnalyticsStateDimensionValue[]>>,
> = {
    readonly [TName in keyof TDimensions]: TDimensions[TName][number]
} & { readonly value: number }

export type AnalyticsStateMetricValue<TMetric extends AnalyticsStateMetricDefinition> =
    TMetric extends {
        readonly dimensions: infer TDimensions extends Readonly<
            Record<string, readonly AnalyticsStateDimensionValue[]>
        >
    }
        ? readonly AnalyticsStateDimensionRow<TDimensions>[]
        : number

export type AnalyticsStateSnapshot<TMetrics extends AnalyticsStateMetricDefinitions> = {
    readonly [TName in keyof TMetrics]: AnalyticsStateMetricValue<TMetrics[TName]>
}

export interface AnalyticsStateConfig<
    TMetrics extends AnalyticsStateMetricDefinitions = AnalyticsStateMetricDefinitions,
> {
    collect: (context: {
        requested: readonly Extract<keyof TMetrics, string>[]
    }) =>
        | Partial<AnalyticsStateSnapshot<TMetrics>>
        | Promise<Partial<AnalyticsStateSnapshot<TMetrics>>>
    metrics: TMetrics
}

export interface AnalyticsConfig<
    TEvents extends AnalyticsEventDefinitions = AnalyticsEventDefinitions,
    TState extends AnalyticsStateMetricDefinitions = AnalyticsStateMetricDefinitions,
> {
    events?: TEvents
    state?: AnalyticsStateConfig<TState>
}

export type AnalyticsEventName<TConfig extends AnalyticsConfig> = Extract<
    keyof NonNullable<TConfig['events']>,
    string
>

type EventPropertyValue<T> = T extends readonly (infer TValue)[]
    ? TValue
    : T extends 'number'
      ? number
      : T extends 'boolean'
        ? boolean
        : string

export type AnalyticsEventProperties<
    TConfig extends AnalyticsConfig,
    TName extends AnalyticsEventName<TConfig>,
> = NonNullable<TConfig['events']>[TName] extends {
    properties: infer TProperties extends Readonly<Record<string, AnalyticsEventProperty>>
}
    ? { [TKey in keyof TProperties]: EventPropertyValue<TProperties[TKey]> }
    : Record<never, never>

export type AnalyticsStateMetricName<TConfig extends AnalyticsConfig> = Extract<
    keyof NonNullable<TConfig['state']>['metrics'],
    string
>

export interface AnalyticsStateSeriesQuery {
    grain?: 'day' | 'month' | 'week' | 'year'
    range: AnalyticsRange
    timezone?: string
}

export interface AnalyticsArchiveOptions {
    retention?: AnalyticsDuration
    storage: Storage
}

export interface CreateAnalyticsOptions<TConfig extends AnalyticsConfig = AnalyticsConfig> {
    adapters: readonly AnalyticsAdapterInput[]
    archive?: AnalyticsArchiveOptions
    config?: TConfig
    defaultSources?: Readonly<Record<string, AnalyticsDatasetRef>>
    environment?: string
    name: string
    now?: () => Date
}

export interface AnalyticsMaintenanceResult {
    pruned: number
    refreshed: number
    warnings?: readonly AnalyticsWarning[]
}

export type AnalyticsDomainSeriesQuery = Omit<AnalyticsQuery, 'dimensions' | 'source'> & {
    dimensions?: readonly [string]
}

export interface AnalyticsDomainClient {
    series: (query: AnalyticsDomainSeriesQuery) => Promise<AnalyticsSeriesReport>
}

export interface AnalyticsStateClient<TConfig extends AnalyticsConfig = AnalyticsConfig> {
    current: (
        requested: AnalyticsStateMetricName<TConfig> | readonly AnalyticsStateMetricName<TConfig>[],
    ) => Promise<Partial<AnalyticsStateSnapshot<NonNullable<TConfig['state']>['metrics']>>>
    series: (
        metric: AnalyticsStateMetricName<TConfig>,
        query: AnalyticsStateSeriesQuery,
    ) => Promise<AnalyticsSeriesReport>
}

type AnalyticsTrackArguments<
    TConfig extends AnalyticsConfig,
    TName extends AnalyticsEventName<TConfig>,
> = keyof AnalyticsEventProperties<TConfig, TName> extends never
    ? []
    : [properties: AnalyticsEventProperties<TConfig, TName>]

export interface AnalyticsClient<TConfig extends AnalyticsConfig = AnalyticsConfig> {
    experience: AnalyticsDomainClient
    maintenance: {
        run(): Promise<AnalyticsMaintenanceResult>
    }
    query(query: AnalyticsQuery): Promise<AnalyticsReport>
    search: AnalyticsDomainClient
    state: AnalyticsStateClient<TConfig>
    track: <TName extends AnalyticsEventName<TConfig>>(
        name: TName,
        ...arguments_: AnalyticsTrackArguments<TConfig, TName>
    ) => Promise<void>
    traffic: AnalyticsDomainClient
}
