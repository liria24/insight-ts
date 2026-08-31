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

export interface QueryResult<
    TData,
    TMeta extends object = Record<never, never>,
    TSource extends string = string,
> {
    data: TData
    meta: {
        quality?: QueryQuality
        queriedAt: string
        source: TSource
    } & TMeta
}

export interface SourceExecutionResult<TData, TMeta extends object = Record<never, never>> {
    data: TData
    meta?: TMeta
    quality?: QueryQuality
}

export interface SourceExecutionContext {
    provider: string
    signal?: AbortSignal
    source: string
}

export declare const sourceResultType: unique symbol
export declare const sourceDefinitionType: unique symbol

export interface SourceResultResolver {
    readonly data: unknown
    readonly query: unknown
}

export interface SourceDefinition<
    TQuery = unknown,
    TNormalized = TQuery,
    TData = unknown,
    TMeta extends object = Record<never, never>,
> {
    readonly [sourceDefinitionType]?: {
        data: TData
        meta: TMeta
        normalized: TNormalized
        query: TQuery
    }
    execute(
        query: TNormalized,
        context: SourceExecutionContext,
    ): Awaitable<SourceExecutionResult<TData, TMeta>>
    key(query: TNormalized): string
    normalize(query: TQuery): TNormalized
}

export type SourceDefinitions = Readonly<Record<string, unknown>>

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
    execute(): Promise<SourceExecutionResult<unknown, object>>
    key: string
    query: unknown
    source: string
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
    TSources extends SourceDefinitions = SourceDefinitions,
> {
    events?: EventDestination
    execute?(
        requests: readonly ProviderExecutionRequest[],
        context: ProviderExecutionContext,
    ): Awaitable<readonly SourceExecutionResult<unknown, object>[]>
    id: TId
    sources?: TSources
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

export interface RuntimeSource {
    definition: SourceDefinition
    id: string
    key: string
    provider: ProviderDefinition
}

export interface SourceRequest {
    query: unknown
    source: RuntimeSource
}

export interface QueryExecutionOptions {
    signal?: AbortSignal
}

export interface HistoryRuntimeContext {
    execute(
        requests: readonly SourceRequest[],
        options?: QueryExecutionOptions,
    ): Promise<readonly QueryResult<unknown, object>[]>
    instrumentation?: Instrumentation
    now(): Date
    sources: readonly RuntimeSource[]
}

export type HistoryRuntime<TController extends object = object> = TController & {
    handles(source: RuntimeSource, query: unknown): boolean
    query(
        source: RuntimeSource,
        query: unknown,
        live: () => Promise<QueryResult<unknown, object>>,
    ): Promise<QueryResult<unknown, object>>
}

export interface HistoryExtension<TController extends object = object> {
    attach(context: HistoryRuntimeContext): HistoryRuntime<TController>
}

export interface CreateInsightOptions<
    TEvents extends EventDefinitions = EventDefinitions,
    TProviders extends readonly ProviderDefinition[] = readonly ProviderDefinition[],
> extends InsightSchema<TEvents> {
    history?: HistoryExtension
    instrumentation?: Instrumentation
    now?: () => Date
    providers: TProviders
}

type ProviderUnion<TProviders extends readonly ProviderDefinition[]> = TProviders[number]

type ProviderAccessor<TId extends string> = TId extends `${infer THead}-${infer TTail}`
    ? `${THead}${Capitalize<ProviderAccessor<TTail>>}`
    : TId

export type SourceId<TProviders extends readonly ProviderDefinition[]> =
    ProviderUnion<TProviders> extends infer TProvider
        ? TProvider extends {
              id: infer TId extends string
              sources?: infer TSources extends SourceDefinitions
          }
            ? `${TId}.${Extract<keyof TSources, string>}`
            : never
        : never

type SourceForProvider<TProvider, TSource extends string> = TProvider extends {
    id: infer TId extends string
    sources?: infer TSources extends SourceDefinitions
}
    ? TSource extends `${TId}.${infer TKey}`
        ? TKey extends keyof TSources
            ? TSources[TKey]
            : never
        : never
    : never

export type SourceFor<
    TProviders extends readonly ProviderDefinition[],
    TSource extends SourceId<TProviders>,
> = SourceForProvider<ProviderUnion<TProviders>, TSource>

type SourceTypes<TSource> = TSource extends object
    ? typeof sourceDefinitionType extends keyof TSource
        ? NonNullable<TSource[typeof sourceDefinitionType]>
        : never
    : never
export type QueryOf<TSource> = SourceTypes<TSource> extends { query: infer TQuery } ? TQuery : never
export type NormalizedQueryOf<TSource> =
    SourceTypes<TSource> extends {
        normalized: infer TNormalized
    }
        ? TNormalized
        : never
export type DataOf<TSource> = SourceTypes<TSource> extends { data: infer TData } ? TData : never
export type MetaOf<TSource> =
    SourceTypes<TSource> extends { meta: infer TMeta extends object } ? TMeta : never

type DataForQuery<TSource, TQuery> = TSource extends object
    ? typeof sourceResultType extends keyof TSource
        ? NonNullable<TSource[typeof sourceResultType]> extends SourceResultResolver
            ? (NonNullable<TSource[typeof sourceResultType]> & { readonly query: TQuery })['data']
            : DataOf<TSource>
        : DataOf<TSource>
    : DataOf<TSource>

export interface QueryDescriptor<TResult extends QueryResult<unknown, object>> {
    readonly result?: TResult
}

export type QuerySelection = Readonly<Record<string, QueryDescriptor<QueryResult<unknown, object>>>>
export type QuerySelectionResult<TSelection extends QuerySelection> = {
    readonly [TKey in keyof TSelection]: NonNullable<TSelection[TKey]['result']>
}

export interface SourceCatalogEntry {
    id: string
    provider: string
}

type TrackArguments<
    TSchema extends InsightSchema,
    TName extends EventName<TSchema>,
> = keyof EventProperties<TSchema, TName> extends never
    ? []
    : [properties: EventProperties<TSchema, TName>]

type SourceQueryAccessor<TSource, TSourceId extends string> = <
    const TQuery extends QueryOf<TSource>,
>(
    query: TQuery,
) => QueryDescriptor<QueryResult<DataForQuery<TSource, TQuery>, MetaOf<TSource>, TSourceId>>

type ProviderSourceAccessors<TProvider> = TProvider extends {
    id: infer TId extends string
    sources?: infer TSources extends SourceDefinitions
}
    ? {
          readonly [TKey in Extract<keyof TSources, string>]: SourceQueryAccessor<
              TSources[TKey],
              `${TId}.${TKey}`
          >
      }
    : never

type QuerySourceAccessors<TProviders extends readonly ProviderDefinition[]> = {
    readonly [
        TProvider in ProviderUnion<TProviders> as TProvider extends {
            id: infer TId extends string
        }
            ? ProviderAccessor<TId>
            : never
    ]: ProviderSourceAccessors<TProvider>
}

export interface QueryBuilder<TProviders extends readonly ProviderDefinition[]> {
    source: QuerySourceAccessors<TProviders>
}

export type InsightClient<TOptions extends CreateInsightOptions> = {
    query<const TSelection extends QuerySelection>(
        select: (query: QueryBuilder<TOptions['providers']>) => TSelection,
        options?: QueryExecutionOptions,
    ): Promise<QuerySelectionResult<TSelection>>
    sources(): readonly SourceCatalogEntry[]
    track<TName extends EventName<TOptions>>(
        name: TName,
        ...arguments_: TrackArguments<TOptions, TName>
    ): Promise<void>
} & (TOptions extends { history: HistoryExtension<infer TController> }
    ? { history: TController }
    : {})
