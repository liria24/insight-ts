import type { TimeRange } from './time.ts'

export type Awaitable<T> = Promise<T> | T

export interface Warning {
    code: string
    message: string
}

export interface QueryQuality {
    approximate?: boolean
    partial?: boolean
    sampled?: boolean
    sampleRate?: number
    thresholded?: boolean
    warnings?: readonly Warning[]
}

export type HistoryTransformation =
    | { kind: 'sample'; rate: number }
    | { id: string; kind: 'filter' }
    | { kind: 'truncate'; limit: number }
    | { id: string; kind: 'custom' }

export interface HistoryFidelity {
    preservation: 'full' | 'reduced' | 'not-preserved'
    transformations: readonly HistoryTransformation[]
}

export interface HistoryFidelityBand extends HistoryFidelity {
    range: TimeRange
}

declare const cursorBrand: unique symbol
export type InsightCursor = string & { readonly [cursorBrand]?: never }

export interface QueryContribution {
    fields?: readonly string[]
    quality?: QueryQuality
}

export interface QueryPagination {
    next?: InsightCursor
}

export interface QueryResult<TData, TMeta extends object = Record<never, never>> {
    data: TData
    meta: {
        contributions: readonly QueryContribution[]
        pagination?: QueryPagination
        quality?: QueryQuality
        queriedAt: string
    } & TMeta
}

export interface AdapterExecutionResult<TData, TMeta extends object = Record<never, never>> {
    data: TData
    meta?: TMeta
    nativeCursor?: string
    quality?: QueryQuality
}

export interface AdapterExecutionContext {
    adapter: string
    provider: string
    scope: string
    signal?: AbortSignal
}

declare const adapterDefinitionType: unique symbol

export interface CapabilitySchema<
    TQuery extends object = Record<string, unknown>,
    TData = unknown,
    TMeta extends object = Record<never, never>,
    TSelections extends Readonly<Record<string, string>> = Record<never, never>,
    TRequiredSelection extends keyof TSelections = never,
> {
    readonly data: TData
    readonly meta: TMeta
    readonly query: TQuery
    readonly requiredSelections: TRequiredSelection
    readonly selections: TSelections
}

interface CapabilitySchemaShape {
    readonly data: unknown
    readonly meta: object
    readonly query: object
    readonly requiredSelections: PropertyKey
    readonly selections: Readonly<Record<string, string>>
}

export interface CapabilityContribution {
    adapter: RuntimeAdapter
    plan: unknown
    result: AdapterExecutionResult<unknown, object>
}

export interface CapabilityExecutionResult<
    TData = unknown,
    TMeta extends object = object,
> extends AdapterExecutionResult<TData, TMeta> {
    contributions?: readonly QueryContribution[]
    pagination?: QueryPagination
}

export interface CapabilityContract<TName extends string = string, TNormalized = unknown> {
    readonly name: TName
    key(query: TNormalized): string
    merge(
        query: TNormalized,
        contributions: readonly CapabilityContribution[],
    ): CapabilityExecutionResult
    normalize(query: unknown, adapters: readonly object[]): TNormalized
    plan(query: TNormalized, adapter: object): TNormalized | undefined
    validate?(adapters: readonly object[]): void
}

export interface CapabilityAdapterDefinition<
    TName extends string = string,
    TSchema extends CapabilitySchemaShape = CapabilitySchemaShape,
    TQuery = unknown,
    TNormalized = TQuery,
    TData = unknown,
    TMeta extends object = Record<never, never>,
> {
    readonly [adapterDefinitionType]?: {
        data: TData
        meta: TMeta
        normalized: TNormalized
        query: TQuery
        schema: TSchema
    }
    readonly contract: CapabilityContract<TName, TNormalized>
    execute(
        query: TNormalized,
        context: AdapterExecutionContext,
    ): Awaitable<AdapterExecutionResult<TData, TMeta>>
    key(query: TNormalized): string
    materialize?: HistoryMaterializer<TNormalized, TData, TMeta>
    normalize(query: TQuery): TNormalized
}

export interface HistoryMaterializer<
    TQuery = unknown,
    TData = unknown,
    TMeta extends object = object,
> {
    capture(range: TimeRange): TQuery
    continue?(query: TQuery, nativeCursor: string): TQuery
    cursor?(query: TQuery): string | undefined
    itemId(item: unknown, index: number): string
    items(data: TData): readonly unknown[]
    limit?(query: TQuery): number | undefined
    materialize(query: TQuery, items: readonly unknown[]): AdapterExecutionResult<TData, TMeta>
    range(query: TQuery): TimeRange | undefined
    read: 'all' | 'bounded'
    sortKey(item: unknown): string
}

export type CapabilityAdapters = Readonly<Record<string, unknown>>

export interface InstrumentationSpan {
    recordException(error: unknown): void
    setAttribute(name: string, value: boolean | number | string): void
}

export interface Instrumentation {
    activeTraceContext?(): { spanId: string; traceId: string } | undefined
    run<T>(
        name: string,
        attributes: Readonly<Record<string, boolean | number | string>>,
        operation: (span: InstrumentationSpan) => Awaitable<T>,
    ): Awaitable<T>
}

export interface ProviderExecutionRequest {
    adapter: string
    execute(): Promise<AdapterExecutionResult<unknown, object>>
    key: string
    query: unknown
}

export interface ProviderExecutionContext {
    signal?: AbortSignal
}

export interface Event {
    context?: { spanId?: string; traceId?: string }
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
    TAdapters extends CapabilityAdapters = CapabilityAdapters,
> {
    adapters?: TAdapters
    events?: EventDestination
    execute?(
        requests: readonly ProviderExecutionRequest[],
        context: ProviderExecutionContext,
    ): Awaitable<readonly AdapterExecutionResult<unknown, object>[]>
    id: TId
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

export interface RuntimeAdapter {
    definition: CapabilityAdapterDefinition
    id: string
    key: string
    provider: ProviderDefinition
    scope: string
}

export interface AdapterRequest {
    query: unknown
    source: RuntimeAdapter
}

export interface QueryExecutionOptions {
    signal?: AbortSignal
}

export interface HistoryRuntimeContext {
    execute(
        requests: readonly AdapterRequest[],
        options?: QueryExecutionOptions,
    ): Promise<readonly AdapterExecutionResult<unknown, object>[]>
    instrumentation?: Instrumentation
    now(): Date
    sources: readonly RuntimeAdapter[]
}

export type HistoryRuntime<TController extends object = object> = TController & {
    handles(source: RuntimeAdapter, query: unknown): boolean
    query(
        source: RuntimeAdapter,
        query: unknown,
        live: () => Promise<AdapterExecutionResult<unknown, object>>,
    ): Promise<AdapterExecutionResult<unknown, object>>
}

export interface HistoryExtension<TController extends object = object> {
    attach(context: HistoryRuntimeContext): HistoryRuntime<TController>
}

export type ScopeDefinitions = Readonly<Record<string, readonly ProviderDefinition[]>>

export interface CreateInsightOptions<
    TEvents extends EventDefinitions = EventDefinitions,
    TProviders extends readonly ProviderDefinition[] = readonly ProviderDefinition[],
    TScopes extends ScopeDefinitions = ScopeDefinitions,
> extends InsightSchema<TEvents> {
    history?: HistoryExtension
    instrumentation?: Instrumentation
    now?: () => Date
    providers?: TProviders
    scopes?: TScopes
}

type ProviderUnion<TProviders extends readonly ProviderDefinition[]> = TProviders[number]

type AdapterUnion<TProviders extends readonly ProviderDefinition[]> =
    ProviderUnion<TProviders> extends infer TProvider
        ? TProvider extends { adapters?: infer TAdapters extends CapabilityAdapters }
            ? TAdapters[Extract<keyof TAdapters, string>]
            : never
        : never

type SchemaOf<TAdapter> =
    TAdapter extends CapabilityAdapterDefinition<
        infer _TName,
        infer TSchema,
        infer _TQuery,
        infer _TNormalized,
        infer _TData,
        infer _TMeta
    >
        ? TSchema
        : never

type CapabilityName<TAdapters> =
    TAdapters extends CapabilityAdapterDefinition<infer TName> ? TName : never

type AdaptersFor<TAdapters, TName extends string> =
    TAdapters extends CapabilityAdapterDefinition<infer TAdapterName>
        ? TAdapterName extends TName
            ? TAdapters
            : never
        : never

type QueryBase<TSchema> = TSchema extends { query: infer TQuery extends object } ? TQuery : never
type DataForSchema<TSchema> = TSchema extends { data: infer TData } ? TData : never
type MetaForSchema<TSchema> = TSchema extends { meta: infer TMeta extends object } ? TMeta : never
type SelectionsOf<TSchema> = TSchema extends {
    selections: infer TSelections extends Readonly<Record<string, string>>
}
    ? TSelections
    : never
type SelectionKeys<TSchema> = TSchema extends TSchema ? keyof SelectionsOf<TSchema> : never
type SelectionValue<TSchema, TKey extends PropertyKey> = TSchema extends TSchema
    ? TKey extends keyof SelectionsOf<TSchema>
        ? SelectionsOf<TSchema>[TKey]
        : never
    : never
type RequiredSelections<TSchema> = TSchema extends {
    requiredSelections: infer TRequired extends PropertyKey
}
    ? TRequired
    : never
type QueryForSchema<TSchema> = QueryBase<TSchema> & {
    readonly [TKey in Extract<RequiredSelections<TSchema>, string>]: readonly Extract<
        SelectionValue<TSchema, TKey>,
        string
    >[]
} & {
    readonly [
        TKey in Exclude<
            Extract<SelectionKeys<TSchema>, string>,
            Extract<RequiredSelections<TSchema>, string>
        >
    ]?: readonly Extract<SelectionValue<TSchema, TKey>, string>[]
}
type SchemaFor<TAdapters, TName extends string> = SchemaOf<AdaptersFor<TAdapters, TName>>

export interface QueryDescriptor<TResult extends QueryResult<unknown, object>> {
    readonly result?: TResult
}

export type QuerySelection = Readonly<Record<string, QueryDescriptor<QueryResult<unknown, object>>>>
export type QuerySelectionResult<TSelection extends QuerySelection> = {
    readonly [TKey in keyof TSelection]: NonNullable<TSelection[TKey]['result']>
}

type TrackArguments<
    TSchema extends InsightSchema,
    TName extends EventName<TSchema>,
> = keyof EventProperties<TSchema, TName> extends never
    ? []
    : [properties: EventProperties<TSchema, TName>]

type CapabilityAccessor<TAdapters, TName extends string> = <
    const TQuery extends QueryForSchema<SchemaFor<TAdapters, TName>>,
>(
    query: TQuery,
) => QueryDescriptor<
    QueryResult<
        DataForSchema<SchemaFor<TAdapters, TName>>,
        MetaForSchema<SchemaFor<TAdapters, TName>>
    >
>

export type QueryBuilder<TProviders extends readonly ProviderDefinition[]> = {
    readonly [TName in CapabilityName<AdapterUnion<TProviders>>]: CapabilityAccessor<
        AdapterUnion<TProviders>,
        TName
    >
}

type ScopedInsightClient<
    TOptions extends CreateInsightOptions,
    TProviders extends readonly ProviderDefinition[],
> = {
    query<const TSelection extends QuerySelection>(
        select: (query: QueryBuilder<TProviders>) => TSelection,
        options?: QueryExecutionOptions,
    ): Promise<QuerySelectionResult<TSelection>>
    track<TName extends EventName<TOptions>>(
        name: TName,
        ...arguments_: TrackArguments<TOptions, TName>
    ): Promise<void>
}

type ClientForConfiguration<TOptions extends CreateInsightOptions> = TOptions extends {
    scopes: infer TScopes extends ScopeDefinitions
}
    ? {
          scope<TName extends Extract<keyof TScopes, string>>(
              name: TName,
          ): ScopedInsightClient<TOptions, TScopes[TName]>
      }
    : TOptions extends { providers: infer TProviders extends readonly ProviderDefinition[] }
      ? ScopedInsightClient<TOptions, TProviders>
      : never

export type InsightClient<TOptions extends CreateInsightOptions> =
    ClientForConfiguration<TOptions> &
        (TOptions extends { history: HistoryExtension<infer TController> }
            ? { history: TController }
            : {})

// Internal alias keeps the existing History implementation isolated.
export type RuntimeSource = RuntimeAdapter
