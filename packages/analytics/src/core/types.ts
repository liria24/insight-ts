import type { Storage } from 'unstorage'

export type BuiltinAnalyticsDomain = 'traffic' | 'search' | 'product' | 'experience' | 'state'
export type AnalyticsDomain = BuiltinAnalyticsDomain | (string & {})
export type AnalyticsSourceRef = string
export type AnalyticsGrain = 'auto' | 'minute' | 'hour' | 'day' | 'week' | 'month' | 'year'

export interface AnalyticsRange {
    from: string
    to: string
}

export type AnalyticsDuration = `${number}${'h' | 'd' | 'w' | 'm' | 'y'}`
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
    source?: AnalyticsSourceRef
    timezone?: string
}

export interface ResolvedAnalyticsQuery {
    dimensions: readonly string[]
    filters?: AnalyticsFilter
    grain: AnalyticsGrain
    limit?: number
    metrics: readonly string[]
    range: AnalyticsRange
    source: AnalyticsSourceRef
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

export interface AnalyticsMetricDefinition {
    aggregation: AnalyticsMetricAggregation
    derive?: {
        denominator: string
        numerator: string
        operation: 'ratio'
    }
    label?: string
    rollup: AnalyticsMetricRollup
    valueType: AnalyticsMetricValueType
}

export interface AnalyticsDimensionDefinition {
    label?: string
    valueType?: 'boolean' | 'date' | 'datetime' | 'number' | 'string'
}

export interface AnalyticsMetricDescriptor extends AnalyticsMetricDefinition {
    id: string
}

export interface AnalyticsDimensionDescriptor extends AnalyticsDimensionDefinition {
    id: string
}

export interface AnalyticsArchiveMaterialization {
    dimensions?: readonly string[]
    grain?: Exclude<AnalyticsGrain, 'auto'>
    id: string
    metrics: readonly string[]
    start?: string
}

export interface AnalyticsSourceArchive {
    finalizationDelay?: AnalyticsDuration
    initialLookback?: AnalyticsDuration
    materializations: readonly AnalyticsArchiveMaterialization[]
}

export interface AnalyticsSourceDescriptor<
    TMetrics extends Readonly<Record<string, AnalyticsMetricDefinition>> = Readonly<
        Record<string, AnalyticsMetricDefinition>
    >,
    TDimensions extends Readonly<Record<string, AnalyticsDimensionDefinition>> = Readonly<
        Record<string, AnalyticsDimensionDefinition>
    >,
> {
    archive?: AnalyticsSourceArchive
    dimensions: TDimensions
    domain: AnalyticsDomain
    id: AnalyticsSourceRef
    metrics: TMetrics
}

export interface AnalyticsNormalizedSourceDescriptor {
    archive?: AnalyticsSourceArchive
    dimensions: readonly AnalyticsDimensionDescriptor[]
    domain: AnalyticsDomain
    id: AnalyticsSourceRef
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
    source: AnalyticsSourceRef
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
    dimensions?: AnalyticsDimensionValues
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

interface AnalyticsReportFactoryMetadata {
    freshness?: AnalyticsReportMeta['freshness']
    quality?: AnalyticsReportQuality
    temporal?: Omit<AnalyticsReportMeta['temporal'], 'grain'>
}

export interface AnalyticsSummaryResult extends AnalyticsReportFactoryMetadata {
    values: AnalyticsMetricValues
}

export interface AnalyticsSeriesResult extends AnalyticsReportFactoryMetadata {
    points: readonly AnalyticsSeriesPoint[]
}

export interface AnalyticsBreakdownResult extends AnalyticsReportFactoryMetadata {
    rows: readonly AnalyticsTableRow[]
}

export interface AnalyticsSourceQueryContext {
    breakdown(result: AnalyticsBreakdownResult): AnalyticsTableReport
    series(result: AnalyticsSeriesResult): AnalyticsSeriesReport
    summary(result: AnalyticsSummaryResult): AnalyticsScalarReport
}

export interface AnalyticsSource<
    TMetrics extends Readonly<Record<string, AnalyticsMetricDefinition>> = Readonly<
        Record<string, AnalyticsMetricDefinition>
    >,
    TDimensions extends Readonly<Record<string, AnalyticsDimensionDefinition>> = Readonly<
        Record<string, AnalyticsDimensionDefinition>
    >,
> extends AnalyticsSourceDescriptor<TMetrics, TDimensions> {
    query: (
        query: ResolvedAnalyticsQuery,
        context: AnalyticsSourceQueryContext,
    ) => AnalyticsReport | Promise<AnalyticsReport>
    validate?: (query: ResolvedAnalyticsQuery) => void
}

export interface AnalyticsInternalSource {
    provider: string
    query: (query: ResolvedAnalyticsQuery) => Promise<AnalyticsReport>
    source: AnalyticsNormalizedSourceDescriptor
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

export interface AnalyticsEventDestination {
    track: (event: AnalyticsEvent) => Promise<void> | void
}

export interface AnalyticsProvider<
    TSources extends readonly AnalyticsSource[] = readonly AnalyticsSource[],
> {
    eventDestination?: AnalyticsEventDestination
    id: string
    sources: TSources
}

export type AnalyticsEventProperty = 'boolean' | 'number' | 'string' | readonly string[]

export interface AnalyticsEventDefinition {
    properties?: Readonly<Record<string, AnalyticsEventProperty>>
}

export type AnalyticsEventDefinitions = Readonly<Record<string, AnalyticsEventDefinition>>
export type AnalyticsStateDimensionValue = boolean | number | string

export type AnalyticsNormalizedStateRow = Readonly<
    Record<string, AnalyticsStateDimensionValue> & { value: number }
>

export type AnalyticsNormalizedStateValue = number | readonly AnalyticsNormalizedStateRow[]

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

export interface AnalyticsSchema<
    TEvents extends AnalyticsEventDefinitions = AnalyticsEventDefinitions,
    TState extends AnalyticsStateMetricDefinitions = AnalyticsStateMetricDefinitions,
> {
    events?: TEvents
    state?: AnalyticsStateConfig<TState>
}

export interface AnalyticsArchiveOptions {
    retention?: AnalyticsDuration
    storage: Storage
}

export interface AnalyticsConfig<
    TEvents extends AnalyticsEventDefinitions = AnalyticsEventDefinitions,
    TState extends AnalyticsStateMetricDefinitions = AnalyticsStateMetricDefinitions,
    TProviders extends readonly AnalyticsProvider[] = readonly AnalyticsProvider[],
> extends AnalyticsSchema<TEvents, TState> {
    archive?: AnalyticsArchiveOptions
    defaults?: Readonly<Record<string, AnalyticsSourceRef>>
    environment?: string
    name: string
    now?: () => Date
    providers: TProviders
}

export type CreateAnalyticsOptions<
    TEvents extends AnalyticsEventDefinitions = AnalyticsEventDefinitions,
    TState extends AnalyticsStateMetricDefinitions = AnalyticsStateMetricDefinitions,
    TProviders extends readonly AnalyticsProvider[] = readonly AnalyticsProvider[],
> = AnalyticsConfig<TEvents, TState, TProviders>

export type AnalyticsEventName<TConfig extends AnalyticsSchema> = Extract<
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
    TConfig extends AnalyticsSchema,
    TName extends AnalyticsEventName<TConfig>,
> = NonNullable<TConfig['events']>[TName] extends {
    properties: infer TProperties extends Readonly<Record<string, AnalyticsEventProperty>>
}
    ? { [TKey in keyof TProperties]: EventPropertyValue<TProperties[TKey]> }
    : Record<never, never>

export type AnalyticsStateMetricName<TConfig extends AnalyticsSchema> = Extract<
    keyof NonNullable<TConfig['state']>['metrics'],
    string
>

export interface AnalyticsStateSeriesQuery {
    grain?: 'day' | 'month' | 'week' | 'year'
    range: AnalyticsRange
    timezone?: string
}

export interface AnalyticsMaintenanceResult {
    pruned: number
    refreshed: number
    warnings?: readonly AnalyticsWarning[]
}

export type AnalyticsSummaryQuery = Omit<AnalyticsQuery, 'dimensions' | 'grain' | 'source'>
export type AnalyticsSeriesQuery = Omit<AnalyticsQuery, 'dimensions' | 'source'> & {
    grain: Exclude<AnalyticsGrain, 'auto'>
}
export type AnalyticsBreakdownQuery = Omit<AnalyticsQuery, 'grain' | 'source'> & {
    dimensions: readonly string[]
}

export interface AnalyticsDomainClient {
    breakdown(query: AnalyticsBreakdownQuery): Promise<AnalyticsTableReport>
    series(query: AnalyticsSeriesQuery): Promise<AnalyticsSeriesReport>
    summary(query: AnalyticsSummaryQuery): Promise<AnalyticsScalarReport>
}

export interface AnalyticsSourceClient {
    breakdown(query: AnalyticsBreakdownQuery): Promise<AnalyticsTableReport>
    series(query: AnalyticsSeriesQuery): Promise<AnalyticsSeriesReport>
    summary(query: AnalyticsSummaryQuery): Promise<AnalyticsScalarReport>
}

export interface AnalyticsSourceCatalogEntry {
    dimensions: readonly string[]
    domain: AnalyticsDomain
    id: AnalyticsSourceRef
    metrics: readonly string[]
    provider: string
}

export interface AnalyticsStateClient<TConfig extends AnalyticsSchema = AnalyticsSchema> {
    current: (
        requested: AnalyticsStateMetricName<TConfig> | readonly AnalyticsStateMetricName<TConfig>[],
    ) => Promise<Partial<AnalyticsStateSnapshot<NonNullable<TConfig['state']>['metrics']>>>
    series: (
        metric: AnalyticsStateMetricName<TConfig>,
        query: AnalyticsStateSeriesQuery,
    ) => Promise<AnalyticsSeriesReport>
}

type AnalyticsTrackArguments<
    TConfig extends AnalyticsSchema,
    TName extends AnalyticsEventName<TConfig>,
> = keyof AnalyticsEventProperties<TConfig, TName> extends never
    ? []
    : [properties: AnalyticsEventProperties<TConfig, TName>]

export interface AnalyticsClient<TConfig extends AnalyticsSchema = AnalyticsSchema> {
    domain(domain: AnalyticsDomain): AnalyticsDomainClient
    experience: AnalyticsDomainClient
    maintenance: {
        run(): Promise<AnalyticsMaintenanceResult>
    }
    product: AnalyticsDomainClient
    query(query: AnalyticsQuery): Promise<AnalyticsReport>
    search: AnalyticsDomainClient
    source(source: AnalyticsSourceRef): AnalyticsSourceClient
    sources(): readonly AnalyticsSourceCatalogEntry[]
    state: AnalyticsStateClient<TConfig>
    track: <TName extends AnalyticsEventName<TConfig>>(
        name: TName,
        ...arguments_: AnalyticsTrackArguments<TConfig, TName>
    ) => Promise<void>
    traffic: AnalyticsDomainClient
}
