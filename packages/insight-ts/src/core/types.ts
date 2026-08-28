export type Awaitable<T> = Promise<T> | T

export interface TimeRange {
    from: string
    to: string
}

export type Grain = 'minute' | 'hour' | 'day' | 'week' | 'month' | 'year'
export type FilterValue = boolean | number | string | null

export type Filter =
    | {
          field: string
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
          value: FilterValue | readonly FilterValue[]
      }
    | { and: readonly Filter[] }
    | { not: Filter }
    | { or: readonly Filter[] }

export type MetricValueType =
    | 'integer'
    | 'number'
    | 'duration'
    | 'ratio'
    | 'currency'
    | 'position'
    | 'score'

export type MetricAggregation =
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

export type MetricRollup = 'additive' | 'derived' | 'non-additive' | 'provider-defined'

export interface MetricDefinition {
    aggregation?: MetricAggregation
    derive?: {
        denominator: string
        numerator: string
        operation: 'ratio'
    }
    label?: string
    rollup?: MetricRollup
    valueType: MetricValueType
}

export type MetricInput = MetricDefinition | MetricValueType

export interface DimensionDefinition {
    label?: string
    valueType: 'boolean' | 'date' | 'datetime' | 'number' | 'string'
}

export type DimensionInput = DimensionDefinition | DimensionDefinition['valueType']
export type MetricDefinitions = Readonly<Record<string, MetricInput>>
export type DimensionDefinitions = Readonly<Record<string, DimensionInput>>

export interface Warning {
    code: string
    message: string
}

export interface ReportQuality {
    approximate?: boolean
    partial?: boolean
    sampled?: boolean
    sampleRate?: number
    thresholded?: boolean
    warnings?: readonly Warning[]
}

export type HistoryTransformation =
    | { kind: 'sample'; rate: number }
    | { field: string; kind: 'filter' }
    | { fields: readonly string[]; kind: 'omit-fields' }
    | { kind: 'truncate'; limit: number }
    | { grain: Grain; kind: 'aggregate' }
    | { id: string; kind: 'custom' }

export interface HistoryFidelity {
    preservation: 'full' | 'reduced'
    transformations: readonly HistoryTransformation[]
}

export interface HistoryFidelityBand extends HistoryFidelity {
    range: TimeRange
}

export interface ReportMeta<TSource extends string = string> {
    fidelity?: readonly HistoryFidelityBand[]
    freshness?: {
        completeThrough?: string
        incompleteFrom?: string
    }
    quality: ReportQuality
    queriedAt: string
    source: TSource
    temporal: {
        bucketTimezone?: string
        grain?: Grain
        sourceTimezone?: string
    }
}

export type MetricValues<TMetric extends string = string> = Readonly<Record<TMetric, number | null>>
export type DimensionValues<TDimension extends string = string> = Readonly<
    Record<TDimension, FilterValue>
>

export interface ScalarReport<TMetric extends string = string, TSource extends string = string> {
    kind: 'scalar'
    meta: ReportMeta<TSource>
    values: MetricValues<TMetric>
}

export interface SeriesPoint<TMetric extends string = string, TDimension extends string = string> {
    dimensions?: Partial<DimensionValues<TDimension>>
    time: string
    values: MetricValues<TMetric>
}

export interface SeriesReport<
    TMetric extends string = string,
    TDimension extends string = string,
    TSource extends string = string,
> {
    kind: 'series'
    meta: ReportMeta<TSource>
    points: readonly SeriesPoint<TMetric, TDimension>[]
}

export interface TableRow<TMetric extends string = string, TDimension extends string = string> {
    dimensions: DimensionValues<TDimension>
    metrics: MetricValues<TMetric>
}

export interface TableReport<
    TMetric extends string = string,
    TDimension extends string = string,
    TSource extends string = string,
> {
    kind: 'table'
    meta: ReportMeta<TSource>
    rows: readonly TableRow<TMetric, TDimension>[]
}

export type Report = ScalarReport | SeriesReport | TableReport

export interface ResultMetadata {
    freshness?: ReportMeta['freshness']
    quality?: ReportQuality
    temporal?: Omit<ReportMeta['temporal'], 'grain'>
}

export interface SummaryResult<TMetric extends string = string> extends ResultMetadata {
    values: MetricValues<TMetric>
}

export interface SeriesResult<
    TMetric extends string = string,
    TDimension extends string = string,
> extends ResultMetadata {
    points: readonly SeriesPoint<TMetric, TDimension>[]
}

export interface BreakdownResult<
    TMetric extends string = string,
    TDimension extends string = string,
> extends ResultMetadata {
    rows: readonly TableRow<TMetric, TDimension>[]
}

export interface SnapshotResult<TMetric extends string = string> extends ResultMetadata {
    observedAt?: string
    values: MetricValues<TMetric>
}

export interface BaseReportQuery<TMetric extends string = string> {
    filters?: Filter
    metrics: readonly TMetric[]
    range: TimeRange
    timezone?: string
}

export interface SummaryQuery<TMetric extends string = string> extends BaseReportQuery<TMetric> {}

export interface SeriesQuery<TMetric extends string = string> extends BaseReportQuery<TMetric> {
    grain?: Grain
}

export interface BreakdownQuery<
    TMetric extends string = string,
    TDimension extends string = string,
> extends BaseReportQuery<TMetric> {
    dimensions: readonly TDimension[]
    grain?: Grain
    limit?: number
}

export interface SnapshotQuery<TMetric extends string = string> {
    metrics: readonly TMetric[]
}

export type HistoryDeclaration =
    | {
          breakdowns?: readonly string[]
          grain: Grain
          metrics?: readonly string[]
          mode: 'range'
      }
    | { metrics?: readonly string[]; mode: 'snapshot' }

export interface ReportSourceDefinition<
    TMetrics extends MetricDefinitions = MetricDefinitions,
    TDimensions extends DimensionDefinitions = DimensionDefinitions,
> {
    breakdown?: (
        query: BreakdownQuery<Extract<keyof TMetrics, string>, Extract<keyof TDimensions, string>>,
    ) => Awaitable<BreakdownResult>
    dimensions?: TDimensions
    history?: HistoryDeclaration
    metrics: TMetrics
    series?: (query: SeriesQuery<Extract<keyof TMetrics, string>>) => Awaitable<SeriesResult>
    snapshot?: (query: SnapshotQuery<Extract<keyof TMetrics, string>>) => Awaitable<SnapshotResult>
    summary?: (query: SummaryQuery<Extract<keyof TMetrics, string>>) => Awaitable<SummaryResult>
}

export interface Event {
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

export interface EventDestination {
    track: (event: Event) => Awaitable<void>
}

export interface ProviderDefinition<
    TId extends string = string,
    TReports extends Readonly<Record<string, ReportSourceDefinition>> = Readonly<
        Record<string, ReportSourceDefinition>
    >,
> {
    events?: EventDestination
    id: TId
    reports?: TReports
}

export type Provider = ProviderDefinition

export type EventProperty = 'boolean' | 'number' | 'string' | readonly string[]

export interface EventDefinition {
    properties?: Readonly<Record<string, EventProperty>>
}

export type EventDefinitions = Readonly<Record<string, EventDefinition>>

export interface InsightSchema<TEvents extends EventDefinitions = EventDefinitions> {
    events?: TEvents
}

export type EventName<TSchema extends InsightSchema> = Extract<
    keyof NonNullable<TSchema['events']>,
    string
>

type EventPropertyValue<T> = T extends readonly (infer TValue)[]
    ? TValue
    : T extends 'number'
      ? number
      : T extends 'boolean'
        ? boolean
        : string

export type EventProperties<
    TSchema extends InsightSchema,
    TName extends EventName<TSchema>,
> = NonNullable<TSchema['events']>[TName] extends {
    properties: infer TProperties extends Readonly<Record<string, EventProperty>>
}
    ? { readonly [TKey in keyof TProperties]: EventPropertyValue<TProperties[TKey]> }
    : Record<never, never>

export interface RuntimeReportSource {
    definition: ReportSourceDefinition
    id: string
    key: string
    provider: string
}

export type ReportOperation = 'breakdown' | 'series' | 'snapshot' | 'summary'

export interface HistoryRuntimeContext {
    invoke(source: RuntimeReportSource, operation: ReportOperation, query: unknown): Promise<Report>
    now(): Date
    sources: readonly RuntimeReportSource[]
}

export interface HistoryController {
    capture(options?: { sources?: readonly string[] }): Promise<{ captured: number }>
    sync(options: {
        range: TimeRange
        sources?: readonly string[]
    }): Promise<{ fetched: number; skipped: number }>
}

export interface HistoryRuntime extends HistoryController {
    query(
        source: RuntimeReportSource,
        operation: ReportOperation,
        query: unknown,
        live: () => Promise<Report>,
    ): Promise<Report>
}

export interface HistoryExtension {
    attach(context: HistoryRuntimeContext): HistoryRuntime
}

export interface CreateInsightOptions<
    TEvents extends EventDefinitions = EventDefinitions,
    TProviders extends readonly ProviderDefinition[] = readonly ProviderDefinition[],
> extends InsightSchema<TEvents> {
    history?: HistoryExtension
    now?: () => Date
    providers: TProviders
}

type ProviderUnion<TProviders extends readonly ProviderDefinition[]> = TProviders[number]

export type ReportSourceId<TProviders extends readonly ProviderDefinition[]> =
    ProviderUnion<TProviders> extends infer TProvider
        ? TProvider extends {
              id: infer TId extends string
              reports?: infer TReports extends Readonly<Record<string, ReportSourceDefinition>>
          }
            ? `${TId}.${Extract<keyof TReports, string>}`
            : never
        : never

type SourceForProvider<TProvider, TSource extends string> = TProvider extends {
    id: infer TId extends string
    reports?: infer TReports extends Readonly<Record<string, ReportSourceDefinition>>
}
    ? TSource extends `${TId}.${infer TKey}`
        ? TKey extends keyof TReports
            ? TReports[TKey]
            : never
        : never
    : never

export type ReportSourceFor<
    TProviders extends readonly ProviderDefinition[],
    TSource extends ReportSourceId<TProviders>,
> = SourceForProvider<ProviderUnion<TProviders>, TSource>

type MetricKey<TSource> = TSource extends { metrics: infer TMetrics }
    ? Extract<keyof TMetrics, string>
    : never

type DimensionKey<TSource> = TSource extends { dimensions?: infer TDimensions }
    ? Extract<keyof NonNullable<TDimensions>, string>
    : never

type SummaryClient<TSource, TSourceId extends string> = TSource extends {
    summary: (...arguments_: never[]) => unknown
}
    ? {
          summary<const TMetrics extends readonly MetricKey<TSource>[]>(
              query: SummaryQuery<TMetrics[number]> & { metrics: TMetrics },
          ): Promise<ScalarReport<TMetrics[number], TSourceId>>
      }
    : {}

type SeriesClient<TSource, TSourceId extends string> = TSource extends {
    series: (...arguments_: never[]) => unknown
}
    ? {
          series<const TMetrics extends readonly MetricKey<TSource>[]>(
              query: SeriesQuery<TMetrics[number]> & { metrics: TMetrics },
          ): Promise<SeriesReport<TMetrics[number], DimensionKey<TSource>, TSourceId>>
      }
    : TSource extends { history: { mode: 'snapshot' } }
      ? {
            series<const TMetrics extends readonly MetricKey<TSource>[]>(
                query: SeriesQuery<TMetrics[number]> & { metrics: TMetrics },
            ): Promise<SeriesReport<TMetrics[number], DimensionKey<TSource>, TSourceId>>
        }
      : {}

type BreakdownClient<TSource, TSourceId extends string> = TSource extends {
    breakdown: (...arguments_: never[]) => unknown
}
    ? {
          breakdown<
              const TMetrics extends readonly MetricKey<TSource>[],
              const TDimensions extends readonly DimensionKey<TSource>[],
          >(
              query: BreakdownQuery<TMetrics[number], TDimensions[number]> & {
                  dimensions: TDimensions
                  metrics: TMetrics
              },
          ): Promise<TableReport<TMetrics[number], TDimensions[number], TSourceId>>
      }
    : {}

type SnapshotClient<TSource, TSourceId extends string> = TSource extends {
    snapshot: (...arguments_: never[]) => unknown
}
    ? {
          snapshot<const TMetrics extends readonly MetricKey<TSource>[]>(
              query: SnapshotQuery<TMetrics[number]> & { metrics: TMetrics },
          ): Promise<ScalarReport<TMetrics[number], TSourceId>>
      }
    : {}

export type ReportsClient<TSource, TSourceId extends string> = SummaryClient<TSource, TSourceId> &
    SeriesClient<TSource, TSourceId> &
    BreakdownClient<TSource, TSourceId> &
    SnapshotClient<TSource, TSourceId>

type TrackArguments<
    TSchema extends InsightSchema,
    TName extends EventName<TSchema>,
> = keyof EventProperties<TSchema, TName> extends never
    ? []
    : [properties: EventProperties<TSchema, TName>]

export interface SourceCatalogEntry {
    dimensions: readonly string[]
    history?: HistoryDeclaration
    id: string
    metrics: readonly string[]
    operations: readonly ReportOperation[]
    provider: string
}

export type InsightClient<TOptions extends CreateInsightOptions> = {
    reports<TSource extends ReportSourceId<TOptions['providers']>>(
        source: TSource,
    ): ReportsClient<ReportSourceFor<TOptions['providers'], TSource>, TSource>
    sources(): readonly SourceCatalogEntry[]
    track<TName extends EventName<TOptions>>(
        name: TName,
        ...arguments_: TrackArguments<TOptions, TName>
    ): Promise<void>
} & (TOptions extends { history: HistoryExtension } ? { history: HistoryController } : {})
