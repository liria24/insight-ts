import { InsightError, ProviderError } from './errors.ts'
import {
    decodeContinuation,
    encodeContinuation,
    invalidContinuation,
    type Continuation,
} from './pagination.ts'
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
    InsightCursor,
    InstrumentationSpan,
    ProviderDefinition,
    QueryExecutionOptions,
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

type NativeResult = AdapterExecutionResult<unknown, object>

interface ScheduledCaller {
    aborted: () => void
    reject: (reason?: unknown) => void
    resolve: (value: NativeResult) => void
    signal?: AbortSignal
}

interface ScheduledExecution {
    callers: Set<ScheduledCaller>
    controller: AbortController
    request: PreparedAdapterRequest
    requestCount: number
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

    const scheduled = new Map<string, ScheduledExecution>()
    const pending: ScheduledExecution[] = []
    let active = 0
    let flushQueued = false

    const finishScheduled = (
        execution: ScheduledExecution,
        result: { reason: unknown } | { value: NativeResult },
    ) => {
        if (scheduled.get(execution.request.dedupeKey) === execution) {
            scheduled.delete(execution.request.dedupeKey)
        }
        const callers = Array.from(execution.callers)
        const values =
            'value' in result
                ? callers.map((_, index) =>
                      index === 0 ? result.value : structuredClone(result.value),
                  )
                : []
        for (const [index, caller] of callers.entries()) {
            execution.callers.delete(caller)
            caller.signal?.removeEventListener('abort', caller.aborted)
            if ('value' in result) caller.resolve(values[index]!)
            else caller.reject(result.reason)
        }
    }

    const runScheduled = async (execution: ScheduledExecution, flushSize: number) => {
        const { query, source } = execution.request
        try {
            const value = await instrument(
                'insight.provider.execute',
                {
                    'insight.provider': source.provider.id,
                    'insight.request.count': execution.requestCount,
                    'insight.scheduler.deduplicated.count': execution.requestCount - 1,
                    'insight.scheduler.flush.size': flushSize,
                },
                async (span) => {
                    try {
                        return validateExecutionResult(
                            await source.definition.execute(query, {
                                adapter: source.id,
                                provider: source.provider.id,
                                scope: source.scope,
                                signal: execution.controller.signal,
                            }),
                        )
                    } finally {
                        span.setAttribute('insight.request.count', execution.requestCount)
                        span.setAttribute(
                            'insight.scheduler.deduplicated.count',
                            execution.requestCount - 1,
                        )
                    }
                },
            )
            finishScheduled(execution, { value })
        } catch (reason) {
            finishScheduled(execution, { reason })
        } finally {
            active -= 1
            flushScheduled()
        }
    }

    const flushScheduled = () => {
        flushQueued = false
        const ready: ScheduledExecution[] = []
        while (ready.length < concurrency - active) {
            const execution = pending.shift()
            if (!execution) break
            if (execution.callers.size === 0) continue
            ready.push(execution)
        }
        active += ready.length
        for (const execution of ready) void runScheduled(execution, ready.length)
    }

    const scheduleNative = (
        request: PreparedAdapterRequest,
        signal?: AbortSignal,
    ): Promise<NativeResult> => {
        signal?.throwIfAborted()
        let execution = scheduled.get(request.dedupeKey)
        if (!execution) {
            execution = {
                callers: new Set(),
                controller: new AbortController(),
                request,
                requestCount: 0,
            }
            scheduled.set(request.dedupeKey, execution)
            pending.push(execution)
            if (!flushQueued) {
                flushQueued = true
                queueMicrotask(flushScheduled)
            }
        }
        execution.requestCount += 1
        const shared = execution
        return new Promise((resolve, reject) => {
            let caller!: ScheduledCaller
            const aborted = () => {
                if (!shared.callers.delete(caller)) return
                signal?.removeEventListener('abort', aborted)
                reject(signal?.reason)
                if (shared.callers.size === 0) {
                    if (scheduled.get(request.dedupeKey) === shared) {
                        scheduled.delete(request.dedupeKey)
                    }
                    shared.controller.abort(signal?.reason)
                }
            }
            caller = {
                aborted,
                reject,
                resolve,
                ...(signal ? { signal } : {}),
            }
            shared.callers.add(caller)
            signal?.addEventListener('abort', aborted, { once: true })
        })
    }

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

    const executeNative = (
        requests: readonly PreparedAdapterRequest[],
        execution: QueryExecutionOptions = {},
    ): Promise<readonly NativeResult[]> => {
        execution.signal?.throwIfAborted()
        return Promise.all(requests.map((request) => scheduleNative(request, execution.signal)))
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
        continuation?: Continuation,
    ): Promise<QueryResult<Record<PropertyKey, unknown>, object>> => {
        const { adapters, contract, name, scope } = capability
        const normalized = contract.normalize(
            input,
            adapters.map(({ definition }) => definition),
        )
        const queryKey = contract.key(normalized)
        if (typeof queryKey !== 'string') {
            throw new InsightError(
                'INVALID_QUERY',
                `Capability "${name}" returned a non-string query key`,
            )
        }
        if (continuation && continuation.queryKey !== queryKey) throw invalidContinuation()
        if (continuation && !contract.continue) {
            throw new InsightError(
                'UNSUPPORTED_OPERATION',
                `Capability "${name}" does not support pagination`,
            )
        }
        const query = continuation
            ? contract.continue!(normalized, continuation.nativeCursor)
            : normalized
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
        if (continuation) {
            if (
                plans.length !== 1 ||
                continuation.binding !== (await continuationBinding(plans[0]!.source.id))
            ) {
                throw invalidContinuation()
            }
        }
        const executed = await executePlans(plans, execution)
        const merged = contract.merge(
            query,
            plans.map((plan, index) => ({
                adapter: plan.source,
                plan: plan.query,
                result: executed[index]!,
            })),
        )
        const nativeCursor = validateExecutionResult(merged).nativeCursor
        if (continuation && nativeCursor === continuation.nativeCursor) {
            throw new InsightError('INVALID_QUERY', 'Adapter returned a repeated native cursor')
        }
        if (nativeCursor && !contract.continue) {
            throw new InsightError(
                'UNSUPPORTED_OPERATION',
                `Capability "${name}" does not support pagination`,
            )
        }
        if (nativeCursor && plans.length !== 1) {
            throw new InsightError(
                'UNSUPPORTED_OPERATION',
                'Multi-adapter pagination is not supported',
            )
        }
        const next = nativeCursor
            ? encodeContinuation({
                  binding: await continuationBinding(plans[0]!.source.id),
                  capability: name,
                  nativeCursor,
                  query: continuation?.query ?? requireQuery(input),
                  queryKey,
                  scope,
              })
            : undefined
        return queryResult(merged, now(), next)
    }

    const scopedClient = (scope: RuntimeScope) => {
        const client: Record<string, unknown> = Object.create(null)
        Object.defineProperty(client, 'next', {
            enumerable: true,
            value: async (result: unknown, execution: QueryExecutionOptions = {}) => {
                const continuation = resultContinuation(result)
                if (continuation.scope !== scope.name) throw invalidContinuation()
                const capability = scope.capabilities.get(continuation.capability)
                if (!capability) throw invalidContinuation()
                return instrument(
                    'insight.query',
                    { 'insight.scope': scope.name },
                    async (span) => {
                        execution.signal?.throwIfAborted()
                        span.setAttribute('insight.query.count', 1)
                        return executeCapability(
                            capability,
                            continuation.query,
                            execution,
                            continuation,
                        )
                    },
                )
            },
        })
        Object.defineProperty(client, 'track', {
            enumerable: true,
            value: async (name: string, properties?: Readonly<Record<string, unknown>>) => {
                const context = options.instrumentation?.activeTraceContext?.()
                return instrument(
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
                        const event = {
                            ...(context ? { context } : {}),
                            id: crypto.randomUUID(),
                            name,
                            origin: 'server' as const,
                            properties: normalized,
                            timestamp: now().toISOString(),
                        }
                        await deliverEvent(scope.destinations, event)
                    },
                )
            },
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
    next?: InsightCursor,
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
    return {
        ...data,
        meta: {
            ...meta,
            ...(next ? { pagination: { next } } : {}),
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

type EventValidator = (properties: unknown) => Readonly<Record<string, unknown>>

export function compileEvents(events: EventDefinitions | undefined): Map<string, EventValidator> {
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

async function deliverEvent(
    destinations: readonly EventDestination[],
    event: Parameters<EventDestination['track']>[0],
): Promise<void> {
    const deliveries = destinations.map((destination) => ({
        destination,
        error: undefined as unknown,
        failed: false,
    }))
    const attempt = async (delivery: (typeof deliveries)[number]): Promise<void> => {
        try {
            await delivery.destination.track(event)
            delivery.failed = false
        } catch (error) {
            delivery.error = error
            delivery.failed = true
        }
    }

    await Promise.all(deliveries.map(attempt))
    await Promise.all(
        deliveries
            .filter(
                (delivery) =>
                    delivery.failed &&
                    delivery.error instanceof ProviderError &&
                    delivery.error.retryable === true,
            )
            .map(attempt),
    )
    const failed = deliveries.find((delivery) => delivery.failed)
    if (failed) throw failed.error
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

function requireQuery(value: unknown): object {
    if (!isRecord(value)) {
        throw new InsightError('UNSUPPORTED_OPERATION', 'Pagination query is not serializable')
    }
    return value
}

function resultContinuation(value: unknown): Continuation {
    if (!isRecord(value) || !isRecord(value.meta) || !isRecord(value.meta.pagination)) {
        throw new InsightError('INVALID_QUERY', 'Query result has no continuation')
    }
    const next = value.meta.pagination.next
    if (typeof next !== 'string' || next.length === 0) {
        throw new InsightError('INVALID_QUERY', 'Query result has no continuation')
    }
    return decodeContinuation(next)
}

async function continuationBinding(adapter: string): Promise<string> {
    const digest = new Uint8Array(
        await crypto.subtle.digest('SHA-256', new TextEncoder().encode(adapter)),
    )
    return [...digest.subarray(0, 16)].map((byte) => byte.toString(16).padStart(2, '0')).join('')
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
