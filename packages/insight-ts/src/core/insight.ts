import { InsightError } from './errors.ts'
import type {
    AdapterExecutionResult,
    AdapterRequest,
    CapabilityAdapterDefinition,
    CapabilityContract,
    CapabilityExecutionResult,
    CreateInsightOptions,
    EventDefinition,
    EventDefinitions,
    HistoryRuntime,
    InsightClient,
    InstrumentationSpan,
    ProviderDefinition,
    QueryContribution,
    QueryExecutionOptions,
    QueryPagination,
    QueryQuality,
    QueryResult,
    RuntimeAdapter,
} from './types.ts'

const descriptor = Symbol('insight.query')
const concurrency = 8
const defaultScope = 'default'
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
    builder: Record<string, RuntimeCapabilityAccessor>
    capabilities: Map<string, RuntimeCapability>
    name: string
    providers: readonly ProviderDefinition[]
}

interface Descriptor {
    [descriptor]: true
    capability: RuntimeCapability
    query: unknown
}

interface PreparedAdapterRequest extends AdapterRequest {
    dedupeKey: string
}

interface PreparedCapabilityRequest {
    capability: RuntimeCapability
    dedupeKey: string
    plans: readonly PreparedAdapterRequest[]
    query: unknown
}

type RuntimeCapabilityAccessor = (query: unknown) => Descriptor

export const createInsight = <const TOptions extends CreateInsightOptions>(
    options: TOptions,
): InsightClient<TOptions> => {
    const now = options.now ?? (() => new Date())
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
            const query = request.source.definition.normalize(request.query)
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
        const groups = new Map<ProviderDefinition, PreparedAdapterRequest[]>()
        for (const request of requests) {
            const group = groups.get(request.source.provider) ?? []
            group.push(request)
            groups.set(request.source.provider, group)
        }
        const results = new Map<string, AdapterExecutionResult<unknown, object>>()
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
                    results.set(group[index]!.dedupeKey, validateExecutionResult(result))
                }
            }),
        )
        return requests.map(({ dedupeKey }) => results.get(dedupeKey)!)
    }

    const executeAdapterRaw = async (
        requests: readonly AdapterRequest[],
        execution?: QueryExecutionOptions,
    ): Promise<readonly QueryResult<unknown, object>[]> => {
        const prepared = prepareAdapters(requests)
        const values = await executeNative(prepared.unique, execution)
        const results = new Map(
            prepared.unique.map(
                ({ dedupeKey }, index) => [dedupeKey, queryResult(values[index]!, now())] as const,
            ),
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
        const direct = requests.filter(
            (request) => !history?.handles(request.source, request.query),
        )
        const managed = requests.filter((request) =>
            history?.handles(request.source, request.query),
        )
        const directResults = await executeNative(direct, execution)
        const resultByKey = new Map(
            direct.map(({ dedupeKey }, index) => [dedupeKey, directResults[index]!] as const),
        )
        await Promise.all(
            managed.map(async (request) => {
                const value = await history!.query(request.source, request.query, async () => {
                    const [result] = await executeNative([request], execution)
                    return queryResult(result!, now())
                })
                resultByKey.set(request.dedupeKey, executionResult(value))
            }),
        )
        return requests.map(({ dedupeKey }) => resultByKey.get(dedupeKey)!)
    }

    const executeCapabilitySelection = async (
        descriptors: readonly Descriptor[],
        execution: QueryExecutionOptions,
    ): Promise<readonly QueryResult<unknown, object>[]> => {
        const prepared = prepareCapabilities(descriptors)
        const plans = new Map<string, PreparedAdapterRequest>()
        for (const request of prepared.unique) {
            for (const plan of request.plans) plans.set(plan.dedupeKey, plan)
        }
        const uniquePlans = [...plans.values()]
        const executed = await executePlans(uniquePlans, execution)
        const resultByPlan = new Map(
            uniquePlans.map(({ dedupeKey }, index) => [dedupeKey, executed[index]!] as const),
        )
        const resultByRequest = new Map<string, QueryResult<unknown, object>>()
        for (const request of prepared.unique) {
            const merged = request.capability.contract.merge(
                request.query,
                request.plans.map((plan) => ({
                    adapter: plan.source,
                    plan: plan.query,
                    result: resultByPlan.get(plan.dedupeKey)!,
                })),
            )
            resultByRequest.set(request.dedupeKey, queryResult(merged, now()))
        }
        return prepared.keys.map((key) => resultByRequest.get(key)!)
    }

    const scopedClient = (scope: RuntimeScope) => ({
        async query(
            select: (builder: Record<string, RuntimeCapabilityAccessor>) => unknown,
            execution: QueryExecutionOptions = {},
        ) {
            return instrument('insight.query', { 'insight.scope': scope.name }, async (span) => {
                execution.signal?.throwIfAborted()
                const entries = selectionEntries(select(scope.builder))
                span.setAttribute('insight.query.count', entries.length)
                const values = await executeCapabilitySelection(
                    entries.map(([, value]) => value),
                    execution,
                )
                return Object.fromEntries(entries.map(([name], index) => [name, values[index]]))
            })
        },
        async track(name: string, properties?: Readonly<Record<string, unknown>>) {
            return instrument(
                'insight.event.track',
                { 'insight.event.name': name, 'insight.scope': scope.name },
                async () => {
                    const events: EventDefinitions | undefined = options.events
                    const definition =
                        events && Object.hasOwn(events, name) ? events[name] : undefined
                    const normalized = validateEvent(name, definition, properties)
                    const destinations = scope.providers.flatMap(({ events: destination }) =>
                        destination ? [destination] : [],
                    )
                    if (destinations.length === 0) {
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
                        destinations.map(async (destination) => destination.track(event)),
                    )
                },
            )
        },
    })

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

    // Configuration validation and the generated builders preserve the erased generic contract.
    // eslint-disable-next-line typescript/no-unsafe-type-assertion
    return client as unknown as InsightClient<TOptions>

    function prepareCapabilities(descriptors: readonly Descriptor[]) {
        const keys: string[] = []
        const unique = new Map<string, PreparedCapabilityRequest>()
        for (const selected of descriptors) {
            const { adapters, contract, name, scope } = selected.capability
            const query = contract.normalize(
                selected.query,
                adapters.map(({ definition }) => definition),
            )
            const queryKey = contract.key(query)
            if (typeof queryKey !== 'string') {
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
            const dedupeKey = `${scope}\0${name}\0${queryKey}`
            keys.push(dedupeKey)
            unique.set(dedupeKey, {
                capability: selected.capability,
                dedupeKey,
                plans,
                query,
            })
        }
        return { keys, unique: [...unique.values()] }
    }

    async function executeProvider(
        provider: ProviderDefinition,
        requests: readonly PreparedAdapterRequest[],
        execution: QueryExecutionOptions,
    ): Promise<readonly AdapterExecutionResult<unknown, object>[]> {
        const providerRequests = requests.map(({ query, source }) => ({
            adapter: source.id,
            execute: () =>
                Promise.resolve(
                    source.definition.execute(query, {
                        adapter: source.id,
                        provider: provider.id,
                        scope: source.scope,
                        ...(execution.signal ? { signal: execution.signal } : {}),
                    }),
                ),
            key: source.key,
            query,
        }))
        return provider.execute
            ? provider.execute(providerRequests, execution)
            : mapConcurrent(providerRequests, concurrency, ({ execute }) => execute())
    }
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
    // Object.create(null) keeps generated capability names prototype-safe without a Proxy.
    // eslint-disable-next-line typescript/no-unsafe-type-assertion
    const builder = Object.create(null) as Record<string, RuntimeCapabilityAccessor>
    for (const capability of capabilities.values()) {
        capability.contract.validate?.(capability.adapters.map(({ definition }) => definition))
        Object.defineProperty(builder, capability.name, {
            enumerable: true,
            value: (query: unknown): Descriptor => ({ [descriptor]: true, capability, query }),
        })
    }
    return { adapters, builder, capabilities, name, providers }
}

function adapterDefinition(value: unknown, key: string): CapabilityAdapterDefinition {
    if (!isAdapterDefinition(value)) {
        throw new InsightError('INVALID_QUERY', `Adapter "${key}" has an invalid definition`)
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
                `Query selection "${name}" must be created with a canonical capability method`,
            )
        }
        return [name, selected]
    })
}

function queryResult(
    value: CapabilityExecutionResult,
    queriedAt: Date,
): QueryResult<unknown, object> {
    const result = validateExecutionResult(value)
    const meta = result.meta === undefined ? {} : requireRecord(result.meta, 'Capability metadata')
    const contributions = parseContributions(value.contributions)
    const quality = mergeQuality([
        parseQuality(result.quality),
        ...contributions.map(({ quality: contribution }) => contribution),
    ])
    const pagination = parsePagination(value.pagination)
    return {
        data: result.data,
        meta: {
            ...meta,
            contributions,
            ...(pagination ? { pagination } : {}),
            ...(quality ? { quality } : {}),
            queriedAt: queriedAt.toISOString(),
        },
    }
}

function executionResult(
    result: QueryResult<unknown, object>,
): AdapterExecutionResult<unknown, object> {
    const {
        contributions: _contributions,
        pagination: _pagination,
        quality,
        queriedAt: _queriedAt,
        ...meta
    } = result.meta
    return {
        data: result.data,
        ...(Object.keys(meta).length > 0 ? { meta } : {}),
        ...(quality ? { quality } : {}),
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

function parseContributions(value: unknown): readonly QueryContribution[] {
    if (value === undefined) return []
    if (!Array.isArray(value)) {
        throw new InsightError('INVALID_QUERY', 'Query contributions must be an array')
    }
    return value.map((item) => {
        const contribution = requireRecord(item, 'Query contribution')
        if (
            contribution.fields !== undefined &&
            (!Array.isArray(contribution.fields) ||
                contribution.fields.some((field) => typeof field !== 'string'))
        ) {
            throw new InsightError('INVALID_QUERY', 'Query contribution fields must be strings')
        }
        return {
            ...(Array.isArray(contribution.fields) ? { fields: [...contribution.fields] } : {}),
            ...(contribution.quality === undefined
                ? {}
                : { quality: parseQuality(contribution.quality)! }),
        }
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

const isDescriptor = (value: unknown): value is Descriptor =>
    isRecord(value) && value[descriptor] === true

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
