import { AnalyticsArchive } from './archive'
import { AnalyticsError } from './errors'
import { resolveQuery, resolveSource, validateQuery } from './query'
import type {
    AnalyticsBreakdownQuery,
    AnalyticsClient,
    AnalyticsConfig,
    AnalyticsDomain,
    AnalyticsDomainClient,
    AnalyticsEventDefinition,
    AnalyticsEventDefinitions,
    AnalyticsInternalSource,
    AnalyticsNormalizedSourceDescriptor,
    AnalyticsNormalizedStateValue,
    AnalyticsProvider,
    AnalyticsQuery,
    AnalyticsReport,
    AnalyticsReportMeta,
    AnalyticsSchema,
    AnalyticsSource,
    AnalyticsSourceClient,
    AnalyticsSourceQueryContext,
    AnalyticsStateClient,
    AnalyticsStateMetricDefinition,
    AnalyticsStateMetricDefinitions,
    AnalyticsStateMetricName,
    AnalyticsStateSnapshot,
} from './types'

export function defineAnalyticsConfig<
    const TEvents extends AnalyticsEventDefinitions = {},
    const TState extends AnalyticsStateMetricDefinitions = {},
    const TProviders extends readonly AnalyticsProvider[] = readonly AnalyticsProvider[],
>(
    config: AnalyticsConfig<TEvents, TState, TProviders>,
): AnalyticsConfig<TEvents, TState, TProviders> {
    return config
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

function normalizeStateMetricValue(
    definition: AnalyticsStateMetricDefinition,
    value: unknown,
): AnalyticsNormalizedStateValue {
    if (typeof value === 'number') return value
    const dimensions = Object.keys(definition.dimensions ?? {})
    return (Array.isArray(value) ? value : []).map((row) =>
        Object.fromEntries([
            ...dimensions.map((dimension) => [dimension, Reflect.get(row, dimension)]),
            ['value', Reflect.get(row, 'value')],
        ]),
    )
}

function configuredStateNames<TConfig extends AnalyticsSchema>(
    config: TConfig,
): AnalyticsStateMetricName<TConfig>[] {
    // Object.keys preserves these keys; the assertion restores the configured literal union.
    // oxlint-disable-next-line typescript/no-unsafe-type-assertion
    return Object.keys(config.state?.metrics ?? {}) as AnalyticsStateMetricName<TConfig>[]
}

function createStateClient<TConfig extends AnalyticsSchema>(
    config: TConfig,
    archive: AnalyticsArchive | undefined,
): AnalyticsStateClient<TConfig> {
    return {
        async current(requested) {
            const state = config.state
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
            const state = config.state
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
        if (
            properties !== undefined &&
            (!properties || typeof properties !== 'object' || Object.keys(properties).length > 0)
        ) {
            throw new AnalyticsError('INVALID_QUERY', `Event "${name}" does not accept properties`)
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

function normalizeSource(source: AnalyticsSource): AnalyticsNormalizedSourceDescriptor {
    return {
        ...(source.archive ? { archive: source.archive } : {}),
        dimensions: Object.entries(source.dimensions).map(([id, descriptor]) => ({
            id,
            ...descriptor,
        })),
        domain: source.domain,
        id: source.id,
        metrics: Object.entries(source.metrics).map(([id, descriptor]) => ({
            id,
            ...descriptor,
        })),
    }
}

function reportContext(
    query: Parameters<AnalyticsSource['query']>[0],
    queriedAt: Date,
): AnalyticsSourceQueryContext {
    const meta = (
        quality: AnalyticsReportMeta['quality'] | undefined,
        freshness: AnalyticsReportMeta['freshness'] | undefined,
        temporal: Omit<AnalyticsReportMeta['temporal'], 'grain'> | undefined,
    ): AnalyticsReportMeta => ({
        ...(freshness ? { freshness } : {}),
        quality: quality ?? {},
        queriedAt: queriedAt.toISOString(),
        source: query.source,
        temporal: {
            bucketTimezone: query.timezone,
            grain: query.grain,
            ...temporal,
        },
    })
    return {
        breakdown: ({ freshness, quality, rows, temporal }) => ({
            kind: 'table',
            meta: meta(quality, freshness, temporal),
            rows,
        }),
        series: ({ freshness, points, quality, temporal }) => ({
            kind: 'series',
            meta: meta(quality, freshness, temporal),
            points,
        }),
        summary: ({ freshness, quality, temporal, values }) => ({
            kind: 'scalar',
            meta: meta(quality, freshness, temporal),
            values,
        }),
    }
}

function internalSources(
    providers: readonly AnalyticsProvider[],
    now: () => Date,
): AnalyticsInternalSource[] {
    return providers.flatMap((provider) =>
        provider.sources.map((definition) => ({
            provider: provider.id,
            async query(query) {
                return definition.query(query, reportContext(query, now()))
            },
            source: normalizeSource(definition),
            ...(definition.validate ? { validate: definition.validate } : {}),
        })),
    )
}

type ReportKind = AnalyticsReport['kind']

export function createAnalytics<const TConfig extends AnalyticsConfig>(
    options: TConfig,
): AnalyticsClient<TConfig> {
    if (!options.name) {
        throw new AnalyticsError('INVALID_QUERY', 'Analytics project name is required')
    }
    const providerIds = options.providers.map(({ id }) => id)
    if (new Set(providerIds).size !== providerIds.length) {
        throw new AnalyticsError('INVALID_QUERY', 'Analytics provider ids must be unique')
    }
    const now = options.now ?? (() => new Date())
    const sources = internalSources(options.providers, now)
    const sourceIds = sources.map(({ source }) => source.id)
    if (new Set(sourceIds).size !== sourceIds.length) {
        throw new AnalyticsError('INVALID_QUERY', 'Analytics source ids must be unique')
    }
    const eventDestinations = options.providers.flatMap(({ eventDestination }) =>
        eventDestination ? [eventDestination] : [],
    )
    const archive = options.archive
        ? new AnalyticsArchive(options.name, options.environment ?? 'default', options.archive, now)
        : undefined

    const execute = async (
        query: AnalyticsQuery,
        selection: { domain?: AnalyticsDomain; source?: string } = {},
        expectedKind?: ReportKind,
    ): Promise<AnalyticsReport> => {
        validateQuery(query)
        const candidates = selection.domain
            ? sources.filter(({ source }) => source.domain === selection.domain)
            : sources
        const requestedQuery = selection.source ? { ...query, source: selection.source } : query
        const selected = resolveSource(candidates, requestedQuery, options.defaults ?? {})
        const dimensions =
            expectedKind === 'series'
                ? selected.source.dimensions
                      .filter(({ valueType }) => valueType === 'date' || valueType === 'datetime')
                      .slice(0, 1)
                      .map(({ id }) => id)
                : requestedQuery.dimensions
        const effectiveQuery =
            dimensions === undefined ? requestedQuery : { ...requestedQuery, dimensions }
        if (expectedKind === 'series' && dimensions?.length !== 1) {
            throw new AnalyticsError(
                'UNSUPPORTED_DIMENSION',
                `Source "${selected.source.id}" has no usable temporal dimension`,
            )
        }
        const resolved = resolveQuery(effectiveQuery, selected.source.id)
        if (!archive) selected.validate?.(resolved)
        const report = archive
            ? await archive.query(selected, resolved)
            : await selected.query(resolved)
        if (expectedKind && report.kind !== expectedKind) {
            throw new AnalyticsError(
                'INVALID_QUERY',
                `Source "${selected.source.id}" returned ${report.kind}; expected ${expectedKind}`,
            )
        }
        return report
    }

    const scopedClient = (selection: {
        domain?: AnalyticsDomain
        source?: string
    }): AnalyticsDomainClient | AnalyticsSourceClient => ({
        async breakdown(query: AnalyticsBreakdownQuery) {
            if (query.dimensions.length === 0) {
                throw new AnalyticsError(
                    'INVALID_QUERY',
                    'Breakdown queries require at least one dimension',
                )
            }
            // The runtime kind check in execute narrows this public method contract.
            // oxlint-disable-next-line typescript/no-unsafe-type-assertion
            return (await execute(query, selection, 'table')) as Awaited<
                ReturnType<AnalyticsDomainClient['breakdown']>
            >
        },
        async series(query) {
            // The runtime kind check in execute narrows this public method contract.
            // oxlint-disable-next-line typescript/no-unsafe-type-assertion
            return (await execute(query, selection, 'series')) as Awaited<
                ReturnType<AnalyticsDomainClient['series']>
            >
        },
        async summary(query) {
            // The runtime kind check in execute narrows this public method contract.
            // oxlint-disable-next-line typescript/no-unsafe-type-assertion
            return (await execute({ ...query, dimensions: [] }, selection, 'scalar')) as Awaited<
                ReturnType<AnalyticsDomainClient['summary']>
            >
        },
    })
    const state = createStateClient(options, archive)

    return {
        domain: (domain) => scopedClient({ domain }),
        experience: scopedClient({ domain: 'experience' }),
        maintenance: {
            async run() {
                if (!archive) return { pruned: 0, refreshed: 0 }
                const providerResult = await archive.maintain(sources)
                const names = configuredStateNames(options)
                if (names.length === 0) return providerResult
                const snapshot = await state.current(names)
                const values = Object.fromEntries(
                    names.map((name) => [
                        name,
                        normalizeStateMetricValue(
                            options.state?.metrics[name] ?? {},
                            snapshot[name],
                        ),
                    ]),
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
        product: scopedClient({ domain: 'product' }),
        query: (query) => execute(query),
        search: scopedClient({ domain: 'search' }),
        source: (source) => scopedClient({ source }),
        sources: () =>
            sources.map(({ provider, source }) => ({
                dimensions: source.dimensions.map(({ id }) => id),
                domain: source.domain,
                id: source.id,
                metrics: source.metrics.map(({ id }) => id),
                provider,
            })),
        state,
        async track(name, ...arguments_) {
            const events: AnalyticsEventDefinitions | undefined = options.events
            const definition = events && Object.hasOwn(events, name) ? events[name] : undefined
            const properties = validateEvent(name, definition, arguments_[0])
            if (eventDestinations.length === 0) {
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
            await Promise.all(
                eventDestinations.map(async (destination) => destination.track(event)),
            )
        },
        traffic: scopedClient({ domain: 'traffic' }),
    }
}
