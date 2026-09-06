import { InsightError } from './errors.ts'
import type {
    AdapterExecutionResult,
    AdapterRequest,
    CapabilityAdapterDefinition,
    CapabilityContract,
    CapabilityExecutionResult,
    CreateInsightOptions,
    EventDefinitions,
    EventDestination,
    EventProperty,
    HistoryRuntime,
    InsightClient,
    InstrumentationSpan,
    ProviderDefinition,
    QueryExecutionOptions,
    QueryPagination,
    QueryQuality,
    QueryResult,
    RuntimeAdapter,
} from './types.ts'

const concurrency = 8
const defaultScope = 'default'
const reservedCapabilityNames = new Set(['history', 'next', 'scope', 'then', 'track'])
const noopSpan: InstrumentationSpan = {
    recordException() {},
    setAttribute() {},
}

interface RuntimeCapability {
    adapters: RuntimeAdapter[]
    contract: CapabilityContract
    name: string
    scope: string
}

interface RuntimeScope {
    adapters: RuntimeAdapter[]
    capabilities: Map<string, RuntimeCapability>
    destinations: readonly EventDestination[]
    name: string
}

interface PreparedAdapterRequest extends AdapterRequest {
    dedupeKey: string
}

export const createInsight = <const TOptions extends CreateInsightOptions>(
    options: TOptions,
): InsightClient<TOptions> => {
    const now = options.now ?? (() => new Date())
    const eventValidators = compileEvents(options.events)
    const scopes = runtimeScopes(options)

    const instrument = <T>(
        name: string,
        attributes: Readonly<Record<string, boolean | number | string>>,
        operation: (span: InstrumentationSpan) => Promise<T>,
    ): Promise<T> =>
        options.instrumentation
            ? Promise.resolve(options.instrumentation.run(name, attributes, operation))
            : operation(noopSpan)

    const prepareAdapters = (requests: readonly AdapterRequest[]) => {
        const keys: string[] = []
        const unique = new Map<string, PreparedAdapterRequest>()
        for (const request of requests) {
            const query = request.query
            const adapterKey = request.source.definition.key(query)
            if (typeof adapterKey !== 'string') invalidAdapterKey(request.source.id)
            const dedupeKey = `${request.source.scope}\0${request.source.id}\0${adapterKey}`
            keys.push(dedupeKey)
            unique.set(dedupeKey, { dedupeKey, query, source: request.source })
        }
        return { keys, unique: [...unique.values()] }
    }

    const executeNative = async (
        requests: readonly PreparedAdapterRequest[],
        execution: QueryExecutionOptions = {},
    ): Promise<readonly AdapterExecutionResult<unknown, object>[]> => {
        execution.signal?.throwIfAborted()
        return mapConcurrent(requests, concurrency, async ({ query, source }) =>
            instrument(
                'insight.provider.execute',
                {
                    'insight.provider': source.provider.id,
                    'insight.request.count': 1,
                },
                async () =>
                    validateExecutionResult(
                        await source.definition.execute(query, {
                            adapter: source.id,
                            provider: source.provider.id,
                            scope: source.scope,
                            ...(execution.signal ? { signal: execution.signal } : {}),
                        }),
                    ),
            ),
        )
    }

    const executeAdapterRaw = async (
        requests: readonly AdapterRequest[],
        execution?: QueryExecutionOptions,
    ): Promise<readonly AdapterExecutionResult<unknown, object>[]> => {
        const prepared = prepareAdapters(requests)
        const values = await executeNative(prepared.unique, execution)
        const results = new Map(
            prepared.unique.map(({ dedupeKey }, index) => [dedupeKey, values[index]!] as const),
        )
        return prepared.keys.map((key) => results.get(key)!)
    }

    let history: HistoryRuntime | undefined
    if (options.history) {
        history = options.history.attach({
            execute: executeAdapterRaw,
            ...(options.instrumentation ? { instrumentation: options.instrumentation } : {}),
            now,
            sources: [...scopes.values()].flatMap(({ adapters }) => adapters),
        })
    }

    const executePlans = async (
        requests: readonly PreparedAdapterRequest[],
        execution: QueryExecutionOptions,
    ): Promise<readonly AdapterExecutionResult<unknown, object>[]> => {
        const direct: PreparedAdapterRequest[] = []
        const managed: PreparedAdapterRequest[] = []
        for (const request of requests) {
            const partition = history?.handles(request.source, request.query) ? managed : direct
            partition.push(request)
        }
        const directExecution = executeNative(direct, execution)
        const managedExecution = Promise.all(
            managed.map(async (request) => {
                const value = await history!.query(
                    request.source,
                    request.query,
                    async () => {
                        const [result] = await executeNative([request], execution)
                        return result!
                    },
                    execution,
                )
                return [request.dedupeKey, value] as const
            }),
        )
        const [directResults, managedResults] = await Promise.all([
            directExecution,
            managedExecution,
        ])
        const resultByKey = new Map([
            ...direct.map(({ dedupeKey }, index) => [dedupeKey, directResults[index]!] as const),
            ...managedResults,
        ])
        return requests.map(({ dedupeKey }) => resultByKey.get(dedupeKey)!)
    }

    const executeCapability = async (
        capability: RuntimeCapability,
        input: unknown,
        execution: QueryExecutionOptions,
    ): Promise<QueryResult<Record<PropertyKey, unknown>, object>> => {
        const { adapters, contract, name, scope } = capability
        const query = contract.normalize(
            input,
            adapters.map(({ definition }) => definition),
        )
        if (typeof contract.key(query) !== 'string') {
            throw new InsightError(
                'INVALID_QUERY',
                `Capability "${name}" returned a non-string query key`,
            )
        }
        const plans = adapters.flatMap((source) => {
            const plan = contract.plan(query, source.definition)
            if (plan === undefined) return []
            const adapterKey = source.definition.key(plan)
            if (typeof adapterKey !== 'string') invalidAdapterKey(source.id)
            return [
                {
                    dedupeKey: `${scope}\0${source.id}\0${adapterKey}`,
                    query: plan,
                    source,
                },
            ]
        })
        const executed = await executePlans(plans, execution)
        return queryResult(
            contract.merge(
                query,
                plans.map((plan, index) => ({
                    adapter: plan.source,
                    plan: plan.query,
                    result: executed[index]!,
                })),
            ),
            now(),
        )
    }

    const scopedClient = (scope: RuntimeScope) => {
        const client: Record<string, unknown> = Object.create(null)
        Object.defineProperty(client, 'track', {
            enumerable: true,
            value: async (name: string, properties?: Readonly<Record<string, unknown>>) =>
                instrument(
                    'insight.event.track',
                    { 'insight.event.name': name, 'insight.scope': scope.name },
                    async () => {
                        const validator = eventValidators.get(name)
                        if (!validator)
                            throw new InsightError('INVALID_QUERY', `Unknown event: ${name}`)
                        const normalized = validator(properties)
                        if (scope.destinations.length === 0) {
                            throw new InsightError(
                                'CAPABILITY_UNAVAILABLE',
                                'No Provider event destination is configured in the Scope',
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
                        await Promise.all(
                            scope.destinations.map(async (destination) => destination.track(event)),
                        )
                    },
                ),
        })
        for (const capability of scope.capabilities.values()) {
            Object.defineProperty(client, capability.name, {
                enumerable: true,
                value: (query: unknown, execution: QueryExecutionOptions = {}) =>
                    instrument('insight.query', { 'insight.scope': scope.name }, async (span) => {
                        execution.signal?.throwIfAborted()
                        span.setAttribute('insight.query.count', 1)
                        return executeCapability(capability, query, execution)
                    }),
            })
        }
        return client
    }

    const client = options.scopes
        ? {
              ...(history ? { history } : {}),
              scope(name: string) {
                  const scope = scopes.get(name)
                  if (!scope) throw new InsightError('SOURCE_NOT_FOUND', `Unknown Scope: ${name}`)
                  return scopedClient(scope)
              },
          }
        : { ...(history ? { history } : {}), ...scopedClient(scopes.get(defaultScope)!) }

    // Configuration validation and generated methods preserve the erased generic contract.
    // eslint-disable-next-line typescript/no-unsafe-type-assertion
    return client as unknown as InsightClient<TOptions>
}

function runtimeScopes(options: CreateInsightOptions): Map<string, RuntimeScope> {
    if ((options.providers === undefined) === (options.scopes === undefined)) {
        throw new InsightError(
            'INVALID_QUERY',
            'Configure either providers for one Scope or scopes for multiple Scopes',
        )
    }
    const configured: [string, readonly ProviderDefinition[]][] = []
    if (options.scopes) configured.push(...Object.entries(options.scopes))
    else configured.push([defaultScope, options.providers!])
    const scopes = new Map<string, RuntimeScope>()
    for (const [name, providers] of configured) {
        if (!/^[a-z][A-Za-z0-9]*$/.test(name)) {
            throw new InsightError(
                'INVALID_QUERY',
                `Scope "${name}" must use a lower-camel-case ASCII identifier`,
            )
        }
        scopes.set(name, runtimeScope(name, providers))
    }
    if (scopes.size === 0) throw new InsightError('INVALID_QUERY', 'At least one Scope is required')
    return scopes
}

function runtimeScope(name: string, providers: readonly ProviderDefinition[]): RuntimeScope {
    const providerIds = new Set<string>()
    const adapters: RuntimeAdapter[] = []
    const capabilities = new Map<string, RuntimeCapability>()
    const destinations: EventDestination[] = []
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
        const destination = provider.events
        if (destination) destinations.push(destination)
        for (const [key, value] of Object.entries(provider.adapters ?? {})) {
            if (!/^[a-z][A-Za-z0-9]*$/.test(key)) {
                throw new InsightError(
                    'INVALID_QUERY',
                    `Adapter key "${key}" for Provider "${provider.id}" must use lower camel case`,
                )
            }
            const definition = adapterDefinition(value, key)
            const contract = definition.contract
            if (!/^[a-z][A-Za-z0-9]*$/.test(contract.name)) {
                throw new InsightError(
                    'INVALID_QUERY',
                    `Capability name "${contract.name}" must use lower camel case`,
                )
            }
            if (reservedCapabilityNames.has(contract.name)) {
                throw new InsightError(
                    'INVALID_QUERY',
                    `Capability name "${contract.name}" is reserved by the Insight client`,
                )
            }
            const adapter = {
                definition,
                id: `${provider.id}.${key}`,
                key,
                provider,
                scope: name,
            }
            adapters.push(adapter)
            const capability = capabilities.get(contract.name)
            if (capability && capability.contract !== contract) {
                throw new InsightError(
                    'INVALID_QUERY',
                    `Capability "${contract.name}" uses conflicting contracts in Scope "${name}"`,
                )
            }
            if (capability) capability.adapters.push(adapter)
            else {
                capabilities.set(contract.name, {
                    adapters: [adapter],
                    contract,
                    name: contract.name,
                    scope: name,
                })
            }
        }
    }
    for (const capability of capabilities.values()) {
        capability.contract.validate?.(capability.adapters.map(({ definition }) => definition))
    }
    return { adapters, capabilities, destinations, name }
}

function adapterDefinition(value: unknown, key: string): CapabilityAdapterDefinition {
    if (!isAdapterDefinition(value)) {
        throw new InsightError('INVALID_QUERY', `Adapter "${key}" has an invalid definition`)
    }
    return value
}

function queryResult(
    value: CapabilityExecutionResult,
    queriedAt: Date,
): QueryResult<Record<PropertyKey, unknown>, object> {
    const result = validateExecutionResult(value)
    const data = requireRecord(result.data, 'Capability data')
    if (Object.hasOwn(data, 'meta')) {
        throw new InsightError(
            'INVALID_QUERY',
            'Capability data cannot define the reserved meta field',
        )
    }
    const meta = result.meta === undefined ? {} : requireRecord(result.meta, 'Capability metadata')
    const contributions = parseContributions(value.contributions)
    const quality = mergeQuality([
        parseQuality(result.quality),
        ...contributions.map(({ quality: contribution }) => contribution),
    ])
    const pagination = parsePagination(value.pagination)
    return {
        ...data,
        meta: {
            ...meta,
            ...(pagination ? { pagination } : {}),
            ...(quality ? { quality } : {}),
            queriedAt: queriedAt.toISOString(),
        },
    }
}

function validateExecutionResult(value: unknown): AdapterExecutionResult<unknown, object> {
    if (!isRecord(value) || !Object.hasOwn(value, 'data')) {
        throw new InsightError('INVALID_QUERY', 'Adapter returned an invalid execution result')
    }
    if (
        value.nativeCursor !== undefined &&
        (typeof value.nativeCursor !== 'string' || value.nativeCursor.length === 0)
    ) {
        throw new InsightError('INVALID_QUERY', 'Adapter native cursor must be a non-empty string')
    }
    // The data payload remains contract-owned after the shared envelope check.
    // eslint-disable-next-line typescript/no-unsafe-type-assertion
    return value as unknown as AdapterExecutionResult<unknown, object>
}

function parseContributions(value: unknown): readonly { quality?: QueryQuality }[] {
    if (value === undefined) return []
    if (!Array.isArray(value)) {
        throw new InsightError('INVALID_QUERY', 'Query contributions must be an array')
    }
    return value.map((item) => {
        const contribution = requireRecord(item, 'Query contribution')
        return contribution.quality === undefined
            ? {}
            : { quality: parseQuality(contribution.quality)! }
    })
}

function parsePagination(value: unknown): QueryPagination | undefined {
    if (value === undefined) return undefined
    const pagination = requireRecord(value, 'Query pagination')
    if (pagination.next !== undefined && typeof pagination.next !== 'string') {
        throw new InsightError('INVALID_QUERY', 'Query pagination next must be an opaque string')
    }
    return typeof pagination.next === 'string' ? { next: pagination.next } : {}
}

function parseQuality(value: unknown): QueryQuality | undefined {
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
    const parsed = {
        ...(quality.approximate === true ? { approximate: true } : {}),
        ...(quality.partial === true ? { partial: true } : {}),
        ...(quality.sampled === true ? { sampled: true } : {}),
        ...(typeof quality.sampleRate === 'number' ? { sampleRate: quality.sampleRate } : {}),
        ...(quality.thresholded === true ? { thresholded: true } : {}),
        ...(parsedWarnings && parsedWarnings.length > 0 ? { warnings: parsedWarnings } : {}),
    }
    return Object.keys(parsed).length > 0 ? parsed : undefined
}

function mergeQuality(values: readonly (QueryQuality | undefined)[]): QueryQuality | undefined {
    const quality = values.filter((value): value is QueryQuality => value !== undefined)
    if (quality.length === 0) return undefined
    const rates = quality.flatMap(({ sampleRate }) =>
        sampleRate === undefined ? [] : [sampleRate],
    )
    const warnings = new Map<string, { code: string; message: string }>()
    for (const item of quality.flatMap(({ warnings: items }) => items ?? [])) {
        warnings.set(`${item.code}\0${item.message}`, item)
    }
    return {
        ...(quality.some(({ approximate }) => approximate) ? { approximate: true } : {}),
        ...(quality.some(({ partial }) => partial) ? { partial: true } : {}),
        ...(quality.some(({ sampled }) => sampled) ? { sampled: true } : {}),
        ...(rates.length > 0 ? { sampleRate: Math.min(...rates) } : {}),
        ...(quality.some(({ thresholded }) => thresholded) ? { thresholded: true } : {}),
        ...(warnings.size > 0 ? { warnings: [...warnings.values()] } : {}),
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

type EventValidator = (properties: unknown) => Readonly<Record<string, unknown>>

function compileEvents(events: EventDefinitions | undefined): Map<string, EventValidator> {
    const validators = new Map<string, EventValidator>()
    for (const [name, definition] of Object.entries(events ?? {})) {
        if (!definition.properties) {
            validators.set(name, (properties) => {
                if (
                    properties !== undefined &&
                    (!isRecord(properties) || Object.keys(properties).length > 0)
                ) {
                    throw new InsightError(
                        'INVALID_QUERY',
                        `Event "${name}" does not accept properties`,
                    )
                }
                return {}
            })
            continue
        }
        const properties = Object.entries(definition.properties).map(
            ([property, expected]) => [property, compileEventProperty(expected)] as const,
        )
        const allowed = new Set(properties.map(([property]) => property))
        validators.set(name, (input) => {
            if (!isRecord(input)) {
                throw new InsightError('INVALID_QUERY', `Event "${name}" requires properties`)
            }
            for (const property of Object.keys(input)) {
                if (!allowed.has(property)) {
                    throw new InsightError(
                        'INVALID_QUERY',
                        `Unknown property "${property}" for event "${name}"`,
                    )
                }
            }
            for (const [property, validate] of properties) {
                if (!Object.hasOwn(input, property)) {
                    throw new InsightError(
                        'INVALID_QUERY',
                        `Missing property "${property}" for event "${name}"`,
                    )
                }
                if (!validate(input[property])) {
                    throw new InsightError(
                        'INVALID_QUERY',
                        `Invalid property "${property}" for event "${name}"`,
                    )
                }
            }
            return Object.fromEntries(Object.entries(input))
        })
    }
    return validators
}

const compileEventProperty = (expected: EventProperty): ((value: unknown) => boolean) => {
    if (Array.isArray(expected)) {
        const values = new Set(expected)
        return (value) => typeof value === 'string' && values.has(value)
    }
    if (expected === 'number') return (value) => typeof value === 'number' && Number.isFinite(value)
    return (value) => typeof value === expected
}

function invalidAdapterKey(adapter: string): never {
    throw new InsightError('INVALID_QUERY', `Adapter "${adapter}" returned a non-string query key`)
}

function requireRecord(value: unknown, name: string): Record<string, unknown> {
    if (!isRecord(value)) throw new InsightError('INVALID_QUERY', `${name} must be an object`)
    return value
}

function isRecord(value: unknown): value is Record<PropertyKey, unknown> {
    return typeof value === 'object' && value !== null && !Array.isArray(value)
}

const isAdapterDefinition = (value: unknown): value is CapabilityAdapterDefinition =>
    isRecord(value) &&
    isRecord(value.contract) &&
    typeof value.contract.name === 'string' &&
    typeof value.contract.normalize === 'function' &&
    typeof value.contract.plan === 'function' &&
    typeof value.contract.key === 'function' &&
    typeof value.contract.merge === 'function' &&
    typeof value.normalize === 'function' &&
    typeof value.key === 'function' &&
    typeof value.execute === 'function'
