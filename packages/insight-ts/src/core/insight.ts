import { InsightError } from './errors.ts'
import type {
    CreateInsightOptions,
    EventDefinition,
    EventDefinitions,
    HistoryRuntime,
    InsightClient,
    InstrumentationSpan,
    ProviderDefinition,
    QueryExecutionOptions,
    QueryResult,
    RuntimeSource,
    SourceExecutionResult,
    SourceRequest,
} from './types.ts'

const descriptor = Symbol('insight.query')
const concurrency = 8
const noopSpan: InstrumentationSpan = {
    recordException() {},
    setAttribute() {},
}

interface Descriptor {
    [descriptor]: true
    query: unknown
    source: RuntimeSource
}

interface PreparedRequest extends SourceRequest {
    dedupeKey: string
}

type RuntimeSourceAccessor = (query: unknown) => Descriptor
type RuntimeSourceAccessors = Record<string, Record<string, RuntimeSourceAccessor>>

export const createInsight = <const TOptions extends CreateInsightOptions>(
    options: TOptions,
): InsightClient<TOptions> => {
    const now = options.now ?? (() => new Date())
    const { accessors, sources } = runtimeSources(options.providers)

    const instrument = <T>(
        name: string,
        attributes: Readonly<Record<string, boolean | number | string>>,
        operation: (span: InstrumentationSpan) => Promise<T>,
    ): Promise<T> =>
        options.instrumentation
            ? Promise.resolve(options.instrumentation.run(name, attributes, operation))
            : operation(noopSpan)

    const prepare = (requests: readonly SourceRequest[]) => {
        const keys: string[] = []
        const unique = new Map<string, PreparedRequest>()
        for (const request of requests) {
            const query = request.source.definition.normalize(request.query)
            const sourceKey = request.source.definition.key(query)
            if (typeof sourceKey !== 'string') {
                throw new InsightError(
                    'INVALID_QUERY',
                    `Source "${request.source.id}" returned a non-string query key`,
                )
            }
            const dedupeKey = `${request.source.id}\0${sourceKey}`
            keys.push(dedupeKey)
            unique.set(dedupeKey, { dedupeKey, query, source: request.source })
        }
        return { keys, unique: [...unique.values()] }
    }

    const executePrepared = async (
        requests: readonly PreparedRequest[],
        execution: QueryExecutionOptions = {},
    ): Promise<readonly QueryResult<unknown, object>[]> => {
        execution.signal?.throwIfAborted()
        const groups = new Map<ProviderDefinition, PreparedRequest[]>()
        for (const request of requests) {
            const group = groups.get(request.source.provider) ?? []
            group.push(request)
            groups.set(request.source.provider, group)
        }
        const results = new Map<string, QueryResult<unknown, object>>()
        await Promise.all(
            [...groups].map(async ([provider, group]) => {
                const executed = await instrument(
                    'insight.provider.execute',
                    {
                        'insight.provider': provider.id,
                        'insight.request.count': group.length,
                    },
                    async () => executeProvider(provider, group, execution),
                )
                if (executed.length !== group.length) {
                    throw new InsightError(
                        'INVALID_QUERY',
                        `Provider "${provider.id}" returned ${executed.length} results for ${group.length} requests`,
                    )
                }
                for (const [index, result] of executed.entries()) {
                    const request = group[index]!
                    results.set(request.dedupeKey, queryResult(request.source.id, result, now()))
                }
            }),
        )
        return requests.map(({ dedupeKey }) => results.get(dedupeKey)!)
    }

    const executeRaw = async (
        requests: readonly SourceRequest[],
        execution?: QueryExecutionOptions,
    ): Promise<readonly QueryResult<unknown, object>[]> => {
        const prepared = prepare(requests)
        const values = await executePrepared(prepared.unique, execution)
        const results = new Map(
            prepared.unique.map(({ dedupeKey }, index) => [dedupeKey, values[index]!] as const),
        )
        return prepared.keys.map((key) => results.get(key)!)
    }

    let history: HistoryRuntime | undefined
    if (options.history) {
        history = options.history.attach({
            execute: executeRaw,
            ...(options.instrumentation ? { instrumentation: options.instrumentation } : {}),
            now,
            sources,
        })
    }

    const executeSelection = async (
        requests: readonly SourceRequest[],
        execution: QueryExecutionOptions = {},
    ): Promise<readonly QueryResult<unknown, object>[]> => {
        const prepared = prepare(requests)
        const direct = prepared.unique.filter(
            (request) => !history?.handles(request.source, request.query),
        )
        const managed = prepared.unique.filter((request) =>
            history?.handles(request.source, request.query),
        )
        const directResults = await executePrepared(direct, execution)
        const resultByKey = new Map(
            direct.map(({ dedupeKey }, index) => [dedupeKey, directResults[index]!] as const),
        )
        await Promise.all(
            managed.map(async (request) => {
                const value = await history!.query(request.source, request.query, async () => {
                    const [result] = await executePrepared([request], execution)
                    return result!
                })
                resultByKey.set(request.dedupeKey, value)
            }),
        )
        return prepared.keys.map((key) => resultByKey.get(key)!)
    }

    const client = {
        ...(history ? { history } : {}),
        async query(
            select: (builder: { source: RuntimeSourceAccessors }) => unknown,
            execution: QueryExecutionOptions = {},
        ) {
            return instrument('insight.query', {}, async (span) => {
                execution.signal?.throwIfAborted()
                const selection = select({ source: accessors })
                const entries = selectionEntries(selection)
                span.setAttribute('insight.query.count', entries.length)
                const values = await executeSelection(
                    entries.map(([, value]) => value),
                    execution,
                )
                return Object.fromEntries(entries.map(([name], index) => [name, values[index]]))
            })
        },
        sources: () => sources.map(({ id, provider }) => ({ id, provider: provider.id })),
        async track(name: string, properties?: Readonly<Record<string, unknown>>) {
            return instrument('insight.event.track', { 'insight.event.name': name }, async () => {
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
                const context = options.instrumentation?.activeTraceContext?.()
                const event = {
                    ...(context ? { context } : {}),
                    id: crypto.randomUUID(),
                    name,
                    origin: 'server' as const,
                    properties: normalized,
                    timestamp: now().toISOString(),
                }
                await Promise.all(destinations.map(async (destination) => destination.track(event)))
            })
        },
    }
    // The implementation validates every erased Source/query boundary before constructing results.
    // eslint-disable-next-line typescript/no-unsafe-type-assertion
    return client as unknown as InsightClient<TOptions>

    async function executeProvider(
        provider: ProviderDefinition,
        requests: readonly PreparedRequest[],
        execution: QueryExecutionOptions,
    ): Promise<readonly SourceExecutionResult<unknown, object>[]> {
        const providerRequests = requests.map(({ query, source }) => ({
            execute: () =>
                Promise.resolve(
                    source.definition.execute(query, {
                        provider: provider.id,
                        ...(execution.signal ? { signal: execution.signal } : {}),
                        source: source.id,
                    }),
                ),
            key: source.key,
            query,
            source: source.id,
        }))
        return provider.execute
            ? provider.execute(providerRequests, execution)
            : mapConcurrent(providerRequests, concurrency, ({ execute }) => execute())
    }
}

function runtimeSources(providers: readonly ProviderDefinition[]): {
    accessors: RuntimeSourceAccessors
    sources: RuntimeSource[]
} {
    // Object.create(null) is intentionally used for prototype-safe generated accessors.
    // eslint-disable-next-line typescript/no-unsafe-type-assertion
    const accessors = Object.create(null) as RuntimeSourceAccessors
    const accessorOwners = new Map<string, string>()
    const providerIds = new Set<string>()
    const sources: RuntimeSource[] = []
    for (const provider of providers) {
        if (!/^[a-z][a-z0-9]*(?:-[a-z0-9]+)*$/.test(provider.id)) {
            throw new InsightError(
                'INVALID_QUERY',
                `Provider id "${provider.id}" must use strict ASCII kebab-case`,
            )
        }
        if (providerIds.has(provider.id)) {
            throw new InsightError('INVALID_QUERY', `Provider id "${provider.id}" is duplicated`)
        }
        providerIds.add(provider.id)

        const accessor = providerAccessor(provider.id)
        const owner = accessorOwners.get(accessor)
        if (owner !== undefined) {
            throw new InsightError(
                'INVALID_QUERY',
                `Provider ids "${owner}" and "${provider.id}" both map to accessor "${accessor}"`,
            )
        }
        accessorOwners.set(accessor, provider.id)
        // Object.create(null) is intentionally used for prototype-safe generated accessors.
        // eslint-disable-next-line typescript/no-unsafe-type-assertion
        const providerAccessors = Object.create(null) as Record<string, RuntimeSourceAccessor>
        Object.defineProperty(accessors, accessor, { enumerable: true, value: providerAccessors })

        for (const [key, value] of Object.entries(provider.sources ?? {})) {
            if (!/^[a-z][A-Za-z0-9]*$/.test(key)) {
                throw new InsightError(
                    'INVALID_QUERY',
                    `Source key "${key}" for Provider "${provider.id}" must be a lower-camel-case ASCII identifier`,
                )
            }
            const definition = sourceDefinition(value, key)
            const source = { definition, id: `${provider.id}.${key}`, key, provider }
            sources.push(source)
            Object.defineProperty(providerAccessors, key, {
                enumerable: true,
                value: (query: unknown): Descriptor => ({ [descriptor]: true, query, source }),
            })
        }
    }
    return { accessors, sources }
}

function providerAccessor(id: string): string {
    return id.replace(/-([a-z0-9])/g, (_match, character: string) => character.toUpperCase())
}

function sourceDefinition(value: unknown, key: string) {
    if (!isSourceDefinition(value)) {
        throw new InsightError('INVALID_QUERY', `Source "${key}" has an invalid definition`)
    }
    return value
}

function selectionEntries(value: unknown): [string, Descriptor][] {
    if (!isRecord(value)) {
        throw new InsightError('INVALID_QUERY', 'Query selection must return an object')
    }
    return Object.entries(value).map(([name, selected]) => {
        if (!isDescriptor(selected)) {
            throw new InsightError(
                'INVALID_QUERY',
                `Query selection "${name}" must be created with a q.source Provider/Source accessor`,
            )
        }
        return [name, selected]
    })
}

function queryResult(
    source: string,
    value: SourceExecutionResult<unknown, object>,
    queriedAt: Date,
): QueryResult<unknown, object> {
    if (!isRecord(value) || !Object.hasOwn(value, 'data')) {
        throw new InsightError(
            'INVALID_QUERY',
            `Source "${source}" returned an invalid execution result`,
        )
    }
    const meta = value.meta === undefined ? {} : requireRecord(value.meta, 'Source metadata')
    const quality = parseQuality(value.quality)
    return {
        data: value.data,
        meta: {
            ...meta,
            ...(quality ? { quality } : {}),
            queriedAt: queriedAt.toISOString(),
            source,
        },
    }
}

function parseQuality(value: unknown) {
    if (value === undefined) return undefined
    const quality = requireRecord(value, 'Query quality')
    const warnings = quality.warnings
    if (warnings !== undefined && !Array.isArray(warnings)) {
        throw new InsightError('INVALID_QUERY', 'Query quality warnings must be an array')
    }
    const parsedWarnings = warnings?.map((item) => {
        const warning = requireRecord(item, 'Query quality warning')
        if (typeof warning.code !== 'string' || typeof warning.message !== 'string') {
            throw new InsightError(
                'INVALID_QUERY',
                'Query quality warnings require code and message strings',
            )
        }
        return { code: warning.code, message: warning.message }
    })
    if (
        quality.sampleRate !== undefined &&
        (typeof quality.sampleRate !== 'number' ||
            !Number.isFinite(quality.sampleRate) ||
            quality.sampleRate < 0 ||
            quality.sampleRate > 1)
    ) {
        throw new InsightError('INVALID_QUERY', 'Query quality sampleRate must be in [0, 1]')
    }
    return {
        ...(quality.approximate === true ? { approximate: true } : {}),
        ...(quality.partial === true ? { partial: true } : {}),
        ...(quality.sampled === true ? { sampled: true } : {}),
        ...(typeof quality.sampleRate === 'number' ? { sampleRate: quality.sampleRate } : {}),
        ...(quality.thresholded === true ? { thresholded: true } : {}),
        ...(parsedWarnings && parsedWarnings.length > 0 ? { warnings: parsedWarnings } : {}),
    }
}

async function mapConcurrent<TInput, TOutput>(
    values: readonly TInput[],
    limit: number,
    mapper: (value: TInput) => Promise<TOutput>,
): Promise<TOutput[]> {
    const results: TOutput[] = []
    let cursor = 0
    await Promise.all(
        Array.from({ length: Math.min(limit, values.length) }, async () => {
            while (cursor < values.length) {
                const index = cursor
                cursor += 1
                // Bounded workers deliberately claim one item at a time.
                // eslint-disable-next-line no-await-in-loop
                results[index] = await mapper(values[index]!)
            }
        }),
    )
    return results
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

function requireRecord(value: unknown, name: string): Record<string, unknown> {
    if (!isRecord(value)) throw new InsightError('INVALID_QUERY', `${name} must be an object`)
    return value
}

function isRecord(value: unknown): value is Record<PropertyKey, unknown> {
    return typeof value === 'object' && value !== null && !Array.isArray(value)
}

const isDescriptor = (value: unknown): value is Descriptor =>
    isRecord(value) && value[descriptor] === true

const isSourceDefinition = (value: unknown): value is RuntimeSource['definition'] =>
    isRecord(value) &&
    typeof value.normalize === 'function' &&
    typeof value.key === 'function' &&
    typeof value.execute === 'function'
