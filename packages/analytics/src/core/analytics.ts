import { AnalyticsArchive } from './archive.ts'
import { AnalyticsError } from './errors.ts'
import { resolveAdapter, resolveQuery, validateQuery } from './query.ts'
import type {
    AnalyticsAdapter,
    AnalyticsAdapterBundle,
    AnalyticsAdapterInput,
    AnalyticsClient,
    AnalyticsConfig,
    AnalyticsDomain,
    AnalyticsDomainSeriesQuery,
    AnalyticsEventDefinition,
    AnalyticsEventDefinitions,
    AnalyticsQuery,
    AnalyticsStateClient,
    AnalyticsStateMetricDefinition,
    AnalyticsStateMetricDefinitions,
    AnalyticsStateMetricName,
    AnalyticsStateSnapshot,
    CreateAnalyticsOptions,
} from './types.ts'

export function defineAnalyticsConfig<
    const TEvents extends AnalyticsEventDefinitions = {},
    const TState extends AnalyticsStateMetricDefinitions = {},
>(config: AnalyticsConfig<TEvents, TState>): AnalyticsConfig<TEvents, TState> {
    return config
}

function isBundle(input: AnalyticsAdapterInput): input is AnalyticsAdapterBundle {
    return 'adapters' in input
}

function validStateValue(definition: AnalyticsStateMetricDefinition, value: unknown): boolean {
    if (!definition.dimensions) return typeof value === 'number' && Number.isFinite(value)
    if (!Array.isArray(value)) return false
    return value.every(
        (row) =>
            Boolean(row) &&
            typeof row === 'object' &&
            'value' in row &&
            typeof row.value === 'number' &&
            Number.isFinite(row.value) &&
            Object.entries(definition.dimensions ?? {}).every(
                ([dimension, allowed]) =>
                    dimension in row && allowed.includes(Reflect.get(row, dimension)),
            ),
    )
}

function stateMetricValue(value: unknown): number {
    if (typeof value === 'number') return value
    if (!Array.isArray(value)) return 0
    return value.reduce((total, row) => {
        if (!row || typeof row !== 'object' || !('value' in row) || typeof row.value !== 'number') {
            return total
        }
        return total + row.value
    }, 0)
}

function configuredStateNames<TConfig extends AnalyticsConfig>(
    config: TConfig | undefined,
): AnalyticsStateMetricName<TConfig>[] {
    // Object.keys preserves these keys; the assertion restores the configured literal union.
    // oxlint-disable-next-line typescript/no-unsafe-type-assertion
    return Object.keys(config?.state?.metrics ?? {}) as AnalyticsStateMetricName<TConfig>[]
}

function createStateClient<TConfig extends AnalyticsConfig>(
    config: TConfig | undefined,
    archive: AnalyticsArchive | undefined,
): AnalyticsStateClient<TConfig> {
    return {
        async current(requested) {
            const state = config?.state
            if (!state) {
                throw new AnalyticsError(
                    'CAPABILITY_UNAVAILABLE',
                    'Application State is not configured',
                )
            }
            const names = [...new Set(typeof requested === 'string' ? [requested] : requested)]
            if (names.length === 0) {
                throw new AnalyticsError('INVALID_QUERY', 'At least one state metric is required')
            }
            for (const name of names) {
                if (!Object.hasOwn(state.metrics, name)) {
                    throw new AnalyticsError('UNSUPPORTED_METRIC', `Unknown state metric: ${name}`)
                }
            }

            const snapshot = await state.collect({ requested: names })
            for (const name of names) {
                if (
                    !Object.hasOwn(snapshot, name) ||
                    !validStateValue(state.metrics[name] ?? {}, snapshot[name])
                ) {
                    throw new AnalyticsError(
                        'INVALID_QUERY',
                        `State collector returned an invalid value for "${name}"`,
                    )
                }
            }
            const selected = Object.fromEntries(names.map((name) => [name, snapshot[name]]))
            // Runtime validation above makes the selected keys and values match the configured schema.
            // oxlint-disable-next-line typescript/no-unsafe-type-assertion
            return selected as Partial<
                AnalyticsStateSnapshot<NonNullable<TConfig['state']>['metrics']>
            >
        },
        async series(metric, query) {
            const state = config?.state
            if (!state || !Object.hasOwn(state.metrics, metric)) {
                throw new AnalyticsError('UNSUPPORTED_METRIC', `Unknown state metric: ${metric}`)
            }
            if (!archive) {
                throw new AnalyticsError(
                    'CAPABILITY_UNAVAILABLE',
                    'Application State history requires an archive',
                )
            }
            return archive.stateSeries(metric, query)
        },
    }
}

function validateEvent(
    name: string,
    definition: AnalyticsEventDefinition | undefined,
    properties: unknown,
): Readonly<Record<string, unknown>> {
    if (!definition) throw new AnalyticsError('INVALID_QUERY', `Unknown analytics event: ${name}`)
    if (!definition.properties) {
        if (properties !== undefined) {
            if (
                !properties ||
                typeof properties !== 'object' ||
                Object.keys(properties).length > 0
            ) {
                throw new AnalyticsError(
                    'INVALID_QUERY',
                    `Event "${name}" does not accept properties`,
                )
            }
        }
        return {}
    }
    if (!properties || typeof properties !== 'object' || Array.isArray(properties)) {
        throw new AnalyticsError('INVALID_QUERY', `Event "${name}" requires properties`)
    }

    for (const property of Object.keys(properties)) {
        if (!Object.hasOwn(definition.properties, property)) {
            throw new AnalyticsError(
                'INVALID_QUERY',
                `Unknown property "${property}" for event "${name}"`,
            )
        }
    }
    for (const [property, expected] of Object.entries(definition.properties)) {
        if (!Object.hasOwn(properties, property)) {
            throw new AnalyticsError(
                'INVALID_QUERY',
                `Missing property "${property}" for event "${name}"`,
            )
        }
        const value = Reflect.get(properties, property)
        const valid = Array.isArray(expected)
            ? typeof value === 'string' && expected.includes(value)
            : expected === 'number'
              ? typeof value === 'number' && Number.isFinite(value)
              : typeof value === expected
        if (!valid) {
            throw new AnalyticsError(
                'INVALID_QUERY',
                `Invalid property "${property}" for event "${name}"`,
            )
        }
    }
    return Object.fromEntries(Object.entries(properties))
}

export function createAnalytics<const TConfig extends AnalyticsConfig = AnalyticsConfig>(
    options: CreateAnalyticsOptions<TConfig>,
): AnalyticsClient<TConfig> {
    if (!options.name) {
        throw new AnalyticsError('INVALID_QUERY', 'Analytics project name is required')
    }
    const bundles = options.adapters.filter(isBundle)
    const adapters: AnalyticsAdapter[] = options.adapters.flatMap((input) =>
        isBundle(input) ? input.adapters : [input],
    )
    const eventSinks = bundles.flatMap(({ eventSink }) => (eventSink ? [eventSink] : []))
    const ids = adapters.map(({ dataset }) => dataset.id)
    if (new Set(ids).size !== ids.length) {
        throw new AnalyticsError('INVALID_QUERY', 'Analytics dataset ids must be unique')
    }

    const now = options.now ?? (() => new Date())
    const archive = options.archive
        ? new AnalyticsArchive(options.name, options.environment ?? 'default', options.archive, now)
        : undefined

    const execute = async (query: AnalyticsQuery, domain?: AnalyticsDomain, series = false) => {
        const executionNow = now()
        validateQuery(query, executionNow)
        const candidates = domain
            ? adapters.filter(({ dataset }) => dataset.domain === domain)
            : adapters
        const adapter = resolveAdapter(candidates, query, options.defaultSources ?? {})
        const effectiveQuery = series
            ? {
                  ...query,
                  dimensions:
                      query.dimensions ??
                      adapter.dataset.dimensions
                          .filter(
                              ({ valueType }) => valueType === 'date' || valueType === 'datetime',
                          )
                          .slice(0, 1)
                          .map(({ id }) => id),
              }
            : query
        if (series) {
            const dimension = effectiveQuery.dimensions?.[0]
            const descriptor = adapter.dataset.dimensions.find(({ id }) => id === dimension)
            if (
                effectiveQuery.dimensions?.length !== 1 ||
                (descriptor?.valueType !== 'date' && descriptor?.valueType !== 'datetime')
            ) {
                throw new AnalyticsError(
                    'UNSUPPORTED_DIMENSION',
                    `Dataset "${adapter.dataset.id}" has no usable temporal dimension`,
                )
            }
        }
        const resolved = resolveQuery(effectiveQuery, adapter.dataset.id, executionNow)
        if (!archive) adapter.validate?.(resolved)
        const report = archive
            ? await archive.query(adapter, resolved)
            : await adapter.query(resolved)
        return report
    }

    const domainClient = (domain: AnalyticsDomain) => ({
        async series(query: AnalyticsDomainSeriesQuery) {
            const report = await execute(query, domain, true)
            if (report.kind !== 'series') {
                throw new AnalyticsError(
                    'INVALID_QUERY',
                    'The selected adapter did not return a series',
                )
            }
            return report
        },
    })
    const state = createStateClient(options.config, archive)

    return {
        experience: domainClient('experience'),
        maintenance: {
            async run() {
                if (!archive) return { pruned: 0, refreshed: 0 }
                const providerResult = await archive.maintain(adapters)
                const names = configuredStateNames(options.config)
                if (names.length === 0) return providerResult
                const snapshot = await state.current(names)
                const values = Object.fromEntries(
                    names.map((name) => [name, stateMetricValue(snapshot[name])]),
                )
                const stateResult = await archive.maintainState(values)
                const warnings = [
                    ...(providerResult.warnings ?? []),
                    ...(stateResult.warnings ?? []),
                ]
                return {
                    pruned: providerResult.pruned + stateResult.pruned,
                    refreshed: providerResult.refreshed + stateResult.refreshed,
                    ...(warnings.length > 0 ? { warnings } : {}),
                }
            },
        },
        query: (query) => execute(query),
        search: domainClient('search'),
        state,
        async track(name, ...arguments_) {
            const events = options.config?.events
            const definition = events && Object.hasOwn(events, name) ? events[name] : undefined
            const properties = validateEvent(name, definition, arguments_[0])
            if (eventSinks.length === 0) {
                throw new AnalyticsError(
                    'CAPABILITY_UNAVAILABLE',
                    'No analytics event destination is configured',
                )
            }
            const event = {
                id: crypto.randomUUID(),
                name,
                origin: 'server' as const,
                properties,
                timestamp: now().toISOString(),
            }
            await Promise.all(eventSinks.map(async (sink) => sink.track(event)))
        },
        traffic: domainClient('traffic'),
    }
}
