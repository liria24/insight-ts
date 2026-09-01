import { InsightError, ProviderError } from '../../core/errors.ts'
import type { Event, EventDestination, ProviderDefinition } from '../../core/types.ts'
import {
    defineLogAdapter,
    type CanonicalLogFilter,
    type LogAdapterOutput,
    type LogRecord,
    type LogSeverity,
    type NormalizedLogQuery,
} from '../../logs/index.ts'
import {
    defineMetricAdapter,
    type CanonicalWhere,
    type DimensionValue,
    type MetricAdapterOutput,
    type MetricAdapterPoint,
    type MetricValues,
} from '../../metrics/index.ts'
import {
    defineTraceAdapter,
    type CanonicalTraceFilter,
    type NormalizedTraceQuery,
    type TraceAdapterOutput,
    type TraceRecord,
    type TraceStatus,
} from '../../traces/index.ts'
import { fetchWithRetry } from '../shared/fetch-with-retry.ts'
import { resolvedMetricQuery, type ResolvedMetricQuery } from '../shared/types.ts'

const GRAPHQL_ENDPOINT = 'https://api.cloudflare.com/client/v4/graphql'
const ANALYTICS_ENGINE_ENDPOINT = 'https://api.cloudflare.com/client/v4/accounts'
const WORKERS_TELEMETRY_PATH = 'workers/observability/telemetry/query'
const MAX_GRAPHQL_ROWS = 10_000
const MAX_TELEMETRY_ROWS = 2_000
const MAX_INDEX_BYTES = 96
const MAX_BLOB_BYTES = 16 * 1024

type Fetch = (input: RequestInfo | URL, init?: RequestInit) => Promise<Response>

const webDimensionFields = {
    browser: 'userAgentBrowser',
    country: 'countryName',
    device: 'deviceType',
    host: 'requestHost',
    os: 'userAgentOS',
    path: 'requestPath',
    referer: 'refererHost',
} as const

interface GraphQLErrorShape {
    code?: number | string
    extensions?: { code?: number | string }
    message?: string
}

interface WebAnalyticsRow {
    avg?: { sampleInterval?: unknown }
    count?: unknown
    dimensions?: Record<string, unknown>
    sum?: { visits?: unknown }
}

export class CloudflareApiError extends ProviderError {
    constructor(message: string, status: number, code?: number | string) {
        super('cloudflare', message, {
            ...(code === undefined ? {} : { code }),
            retryable: [429, 500, 502, 503, 504].includes(status),
            status,
        })
        this.name = 'CloudflareApiError'
    }
}

interface CloudflareWebAnalyticsOptions {
    accountId: string
    apiToken: string
    fetch?: Fetch
    host?: string
    siteTag: string
}

export interface CloudflareAnalyticsEngineBinding {
    writeDataPoint(point: { blobs?: string[]; doubles?: number[]; indexes?: string[] }): void
}

interface CloudflareAnalyticsEngineOptions {
    accountId?: string
    apiToken?: string
    binding?: CloudflareAnalyticsEngineBinding
    dataset?: string
    fetch?: Fetch
    now?: () => Date
}

interface CloudflareAnalyticsEngineResource {
    adapter?: ReturnType<typeof analyticsEngineAdapter>
    events?: EventDestination
}

export interface CloudflareWorkersObservabilityOptions {
    datasets?: readonly string[]
    fetch?: Fetch
}

export interface CloudflareOptions {
    accountId?: string
    analyticsEngine?: Omit<CloudflareAnalyticsEngineOptions, 'accountId' | 'apiToken'>
    apiToken?: string
    webAnalytics?: Omit<CloudflareWebAnalyticsOptions, 'accountId' | 'apiToken' | 'siteTag'> & {
        siteTag?: string
    }
    workersObservability?: true | CloudflareWorkersObservabilityOptions
}

type CloudflareAdapters<TOptions extends CloudflareOptions> = (TOptions extends {
    webAnalytics: Exclude<CloudflareOptions['webAnalytics'], undefined>
}
    ? { readonly webAnalytics: ReturnType<typeof cloudflareWebAnalytics> }
    : Record<never, never>) &
    (TOptions extends { analyticsEngine: { dataset: string } }
        ? { readonly analyticsEngine: ReturnType<typeof analyticsEngineAdapter> }
        : Record<never, never>) &
    (TOptions extends {
        workersObservability: Exclude<CloudflareOptions['workersObservability'], undefined>
    }
        ? ReturnType<typeof workersObservabilityAdapters>
        : Record<never, never>)

type CloudflareProvider<TOptions extends CloudflareOptions> = ProviderDefinition<
    'cloudflare',
    CloudflareAdapters<TOptions>
> & {
    readonly adapters: CloudflareAdapters<TOptions>
    readonly id: 'cloudflare'
}

function cloudflareWebAnalytics(options: CloudflareWebAnalyticsOptions) {
    const fetcher = options.fetch ?? globalThis.fetch
    const execute = async (
        query: ResolvedMetricQuery,
        signal?: AbortSignal,
    ): Promise<MetricAdapterOutput> => {
        if (!options.accountId || !options.apiToken) {
            throw new InsightError(
                'CONFIGURATION_MISSING',
                'Cloudflare Web Analytics credentials are missing',
            )
        }
        if (!options.siteTag) {
            throw new InsightError(
                'CONFIGURATION_MISSING',
                'Cloudflare Web Analytics siteTag is missing',
            )
        }
        validateWebQuery(query)
        const timeField = query.dimensions.includes('time') ? webTimeField(query.grain) : undefined
        const nativeLimit =
            timeField === 'date' && !['auto', 'day'].includes(query.grain)
                ? MAX_GRAPHQL_ROWS
                : Math.min(query.limit ?? MAX_GRAPHQL_ROWS, MAX_GRAPHQL_ROWS)
        const providerFilter = compileWebFilter(query.where)
        const filter = {
            AND: [
                {
                    datetime_geq: query.range.from,
                    datetime_lt: query.range.to,
                    siteTag: options.siteTag,
                },
                ...(options.host ? [{ requestHost: options.host }] : []),
                ...(providerFilter === undefined ? [] : [providerFilter]),
            ],
        }
        const response = await fetchWithRetry(fetcher, GRAPHQL_ENDPOINT, {
            body: JSON.stringify({
                query: webGraphqlQuery(query, timeField),
                variables: { accountTag: options.accountId, filter, limit: nativeLimit },
            }),
            headers: {
                accept: 'application/json',
                authorization: `Bearer ${options.apiToken}`,
                'content-type': 'application/json',
            },
            method: 'POST',
            ...(signal ? { signal } : {}),
        })
        const payload = await readJson(response, 'Cloudflare GraphQL')
        if (!response.ok) {
            throw apiError(payload, response.status, 'Cloudflare GraphQL request failed')
        }
        const errors = graphqlErrors(payload)
        const rows = webRows(payload)
        if (rows === undefined) {
            throw apiError(
                payload,
                response.status,
                'Cloudflare GraphQL response contained no account data',
            )
        }
        if (!rows.every((row) => isWebAnalyticsRow(row, query))) {
            throw new CloudflareApiError('Cloudflare Web Analytics returned malformed rows', 502)
        }
        if (errors.length > 0 && rows.length === 0) {
            throw apiError(payload, response.status, 'Cloudflare GraphQL query failed')
        }
        return webReport(query, rows, errors, nativeLimit)
    }

    return defineMetricAdapter({
        dimensions: {
            browser: { operators: ['eq', 'ne', 'in', 'notIn'], type: 'string' },
            country: { operators: ['eq', 'ne', 'in', 'notIn'], type: 'string' },
            device: { operators: ['eq', 'ne', 'in', 'notIn'], type: 'string' },
            host: { operators: ['eq', 'ne', 'in', 'notIn'], type: 'string' },
            os: { operators: ['eq', 'ne', 'in', 'notIn'], type: 'string' },
            path: { operators: ['eq', 'ne', 'in', 'notIn'], type: 'string' },
            referer: { operators: ['eq', 'ne', 'in', 'notIn'], type: 'string' },
            time: { operators: [], type: 'datetime' },
        },
        history: { grain: 'day', metrics: ['pageViews', 'visits'] },
        metrics: {
            pageViews: {
                aggregation: { kind: 'sum' },
                rollup: 'additive',
                unit: '{view}',
            },
            visits: {
                aggregation: { kind: 'sum' },
                rollup: 'additive',
                unit: '{visit}',
            },
        },
        execute: (query, { signal }) =>
            execute(resolvedMetricQuery('cloudflare.webAnalytics', query, 'time'), signal),
    })
}

function cloudflareAnalyticsEngine(
    options: CloudflareAnalyticsEngineOptions,
): CloudflareAnalyticsEngineResource {
    if (options.dataset === undefined && options.binding === undefined) {
        throw new TypeError('Analytics Engine requires a dataset or binding')
    }

    const resource: CloudflareAnalyticsEngineResource = {}
    if (options.dataset !== undefined) {
        resource.adapter = analyticsEngineAdapter({
            ...(options.accountId === undefined ? {} : { accountId: options.accountId }),
            ...(options.apiToken === undefined ? {} : { apiToken: options.apiToken }),
            dataset: options.dataset,
            ...(options.fetch === undefined ? {} : { fetch: options.fetch }),
            ...(options.now === undefined ? {} : { now: options.now }),
        })
    }
    if (options.binding !== undefined) {
        resource.events = analyticsEngineSink(options.binding)
    }
    return resource
}

export function cloudflare<const TOptions extends CloudflareOptions>(
    options: TOptions,
): CloudflareProvider<TOptions> {
    const webAnalytics =
        options.webAnalytics === undefined
            ? {}
            : {
                  webAnalytics: cloudflareWebAnalytics({
                      accountId: options.accountId ?? '',
                      apiToken: options.apiToken ?? '',
                      siteTag: options.webAnalytics.siteTag ?? '',
                      ...options.webAnalytics,
                  }),
              }
    const engine =
        options.analyticsEngine === undefined
            ? undefined
            : cloudflareAnalyticsEngine({
                  ...(options.accountId === undefined ? {} : { accountId: options.accountId }),
                  ...(options.apiToken === undefined ? {} : { apiToken: options.apiToken }),
                  ...options.analyticsEngine,
              })
    const observability =
        options.workersObservability === undefined
            ? {}
            : workersObservabilityAdapters({
                  accountId: options.accountId ?? '',
                  apiToken: options.apiToken ?? '',
                  ...(options.workersObservability === true ? {} : options.workersObservability),
              })
    const provider = {
        id: 'cloudflare',
        adapters: {
            ...webAnalytics,
            ...(engine?.adapter === undefined ? {} : { analyticsEngine: engine.adapter }),
            ...observability,
        },
        ...(engine?.events === undefined ? {} : { events: engine.events }),
    } as const
    // Runtime adapter construction follows the same option predicates as CloudflareAdapters.
    // eslint-disable-next-line typescript/no-unsafe-type-assertion
    return provider as CloudflareProvider<TOptions>
}

interface WorkersObservabilityRuntimeOptions extends CloudflareWorkersObservabilityOptions {
    accountId: string
    apiToken: string
}

interface TelemetryFilter {
    key: string
    kind: 'filter'
    operation: string
    type: 'boolean' | 'number' | 'string'
    value?: boolean | number | string
}

function workersObservabilityAdapters(options: WorkersObservabilityRuntimeOptions) {
    return {
        workersLogs: defineLogAdapter({
            attributes: true,
            execute: (query, { signal }) => workersLogs(options, query, signal),
            filters: ['service', 'severity', 'spanId', 'traceId'],
        }),
        workersMetrics: defineMetricAdapter({
            dimensions: { time: { operators: [], type: 'datetime' } },
            execute: (query, { signal }) =>
                workersMetrics(
                    options,
                    resolvedMetricQuery('cloudflare.workersMetrics', query, 'time'),
                    signal,
                ),
            history: { grain: 'day' },
            metrics: {
                workerDurationP95: {
                    aggregation: { kind: 'percentile', quantile: 0.95 },
                    rollup: 'non-additive',
                    unit: 'ms',
                },
                workerInvocations: {
                    aggregation: { kind: 'count' },
                    rollup: 'additive',
                    unit: '{request}',
                },
            },
        }),
        workersTraces: defineTraceAdapter({
            attributes: true,
            execute: (query, { signal }) => workersTraces(options, query, signal),
            filters: ['durationMs', 'name', 'service', 'status', 'traceId'],
        }),
    }
}

async function workersLogs(
    options: WorkersObservabilityRuntimeOptions,
    query: NormalizedLogQuery,
    signal?: AbortSignal,
): Promise<LogAdapterOutput> {
    const limit = Math.min(query.limit ?? MAX_TELEMETRY_ROWS, MAX_TELEMETRY_ROWS)
    const filters = [
        telemetryFilter('$metadata.type', 'eq', 'cf-worker-log'),
        ...compileLogFilters(query.where ?? []),
    ]
    const response = await telemetryQuery(
        options,
        telemetryBody('events', query.time, filters, {
            limit,
            ...(query.nativeCursor ? { offset: query.nativeCursor } : {}),
        }),
        signal,
    )
    const events = record(response.result.events)?.events
    if (!Array.isArray(events)) {
        throw new CloudflareApiError('Cloudflare Workers Logs returned malformed events', 502)
    }
    const logs = events.map(logRecord)
    const last = logs.at(-1)
    return {
        logs,
        ...(logs.length === limit && last ? { nativeCursor: last.id } : {}),
        ...qualityOutput(response.payload, events.some(isTruncatedEvent)),
    }
}

async function workersTraces(
    options: WorkersObservabilityRuntimeOptions,
    query: NormalizedTraceQuery,
    signal?: AbortSignal,
): Promise<TraceAdapterOutput> {
    const limit = Math.min(query.limit ?? MAX_TELEMETRY_ROWS, MAX_TELEMETRY_ROWS)
    const response = await telemetryQuery(
        options,
        telemetryBody('traces', query.time, compileTraceFilters(query.where ?? []), {
            limit,
            ...(query.nativeCursor ? { offset: query.nativeCursor } : {}),
        }),
        signal,
    )
    if (!Array.isArray(response.result.traces)) {
        throw new CloudflareApiError('Cloudflare Workers Traces returned malformed traces', 502)
    }
    const traces = response.result.traces.map(traceRecord)
    const last = traces.at(-1)
    return {
        ...(traces.length === limit && last ? { nativeCursor: last.traceId } : {}),
        ...qualityOutput(response.payload),
        traces,
    }
}

async function workersMetrics(
    options: WorkersObservabilityRuntimeOptions,
    query: ResolvedMetricQuery,
    signal?: AbortSignal,
): Promise<MetricAdapterOutput> {
    if (query.timezone !== 'UTC') {
        throw new InsightError(
            'UNSUPPORTED_OPERATION',
            'Cloudflare Workers metrics support UTC buckets only',
        )
    }
    if (query.dimensions.some((dimension) => dimension !== 'time')) {
        throw new InsightError(
            'UNSUPPORTED_OPERATION',
            'Cloudflare Workers metrics support only the time dimension',
        )
    }
    const calculations = query.metrics.map((metric) =>
        metric === 'workerInvocations'
            ? { alias: metric, operator: 'count' }
            : {
                  alias: metric,
                  key: '$metadata.duration',
                  keyType: 'number',
                  operator: 'p95',
              },
    )
    const granularity = telemetryGranularity(query)
    const response = await telemetryQuery(
        options,
        {
            ...telemetryBody(
                'calculations',
                query.range,
                [telemetryFilter('$metadata.type', 'eq', 'cf-worker-event')],
                {},
            ),
            chart: granularity !== undefined,
            chartType: granularity === undefined ? 'aggregate' : 'timeseries_and_aggregate',
            ...(granularity === undefined ? { ignoreSeries: true } : { granularity }),
            parameters: {
                calculations,
                datasets: options.datasets ?? [],
                filterCombination: 'and',
                filters: [telemetryFilter('$metadata.type', 'eq', 'cf-worker-event')],
            },
        },
        signal,
    )
    if (!Array.isArray(response.result.calculations)) {
        throw new CloudflareApiError(
            'Cloudflare Workers metrics returned malformed calculations',
            502,
        )
    }
    const values: Record<string, number | null> = Object.fromEntries(
        query.metrics.map((metric) => [metric, null]),
    )
    const points = new Map<string, MetricAdapterPoint>()
    let sampleInterval = 1
    for (const value of response.result.calculations) {
        const calculation = record(value)
        const metric = text(calculation?.alias) || text(calculation?.calculation)
        if (!query.metrics.includes(metric)) continue
        const aggregates = Array.isArray(calculation?.aggregates) ? calculation.aggregates : []
        const aggregate = record(aggregates[0])
        values[metric] = number(aggregate?.value)
        sampleInterval = Math.max(sampleInterval, number(aggregate?.sampleInterval) ?? 1)
        const series = Array.isArray(calculation?.series) ? calculation.series : []
        for (const entry of series) {
            const item = record(entry)
            if (typeof item?.time !== 'string' || !Array.isArray(item.data)) continue
            const datum = record(item.data[0])
            sampleInterval = Math.max(sampleInterval, number(datum?.sampleInterval) ?? 1)
            const point = points.get(item.time)
            points.set(item.time, {
                ...(point ?? { time: item.time }),
                values: { ...point?.values, [metric]: number(datum?.value) },
            })
        }
    }
    return {
        meta: {
            temporal: {
                bucketTimezone: 'UTC',
                ...(query.grain === 'auto' ? {} : { grain: query.grain }),
                sourceTimezone: 'UTC',
            },
        },
        ...(points.size > 0
            ? {
                  points: [...points.values()]
                      .toSorted((left, right) => left.time!.localeCompare(right.time!))
                      .slice(0, query.limit),
              }
            : {}),
        ...qualityOutput(response.payload, false, sampleInterval),
        values,
    }
}

function telemetryBody(
    view: 'calculations' | 'events' | 'traces',
    time: { from: string; to: string },
    filters: readonly TelemetryFilter[],
    pagination: { limit?: number; offset?: string },
): Record<string, unknown> {
    return {
        dry: true,
        ...pagination,
        ...(pagination.offset ? { offsetDirection: 'next' } : {}),
        parameters: {
            datasets: [],
            filterCombination: 'and',
            filters,
        },
        queryId: 'insight',
        timeframe: {
            from: new Date(time.from).valueOf(),
            to: new Date(time.to).valueOf(),
        },
        view,
    }
}

async function telemetryQuery(
    options: WorkersObservabilityRuntimeOptions,
    body: Record<string, unknown>,
    signal?: AbortSignal,
): Promise<{ payload: unknown; result: Record<string, unknown> }> {
    if (!options.accountId || !options.apiToken) {
        throw new InsightError(
            'CONFIGURATION_MISSING',
            'Cloudflare Workers Observability credentials are missing',
        )
    }
    const fetcher = options.fetch ?? globalThis.fetch
    const response = await fetchWithRetry(
        fetcher,
        `${ANALYTICS_ENGINE_ENDPOINT}/${encodeURIComponent(options.accountId)}/${WORKERS_TELEMETRY_PATH}`,
        {
            body: JSON.stringify({
                ...body,
                parameters: {
                    ...record(body.parameters),
                    datasets: options.datasets ?? [],
                },
            }),
            headers: {
                accept: 'application/json',
                authorization: `Bearer ${options.apiToken}`,
                'content-type': 'application/json',
            },
            method: 'POST',
            ...(signal ? { signal } : {}),
        },
    )
    const payload = await readJson(response, 'Cloudflare Workers Observability')
    const result = record(record(payload)?.result)
    if (!response.ok || !result) {
        throw apiError(payload, response.status, 'Cloudflare Workers Observability query failed')
    }
    return { payload, result }
}

function compileLogFilters(filters: readonly CanonicalLogFilter[]): TelemetryFilter[] {
    return filters.map((filter) =>
        compileTelemetryFilter(
            filter,
            filter.field === 'severity'
                ? '$metadata.level'
                : filter.field.startsWith('attributes.')
                  ? `$metadata.${filter.field.slice('attributes.'.length)}`
                  : `$metadata.${filter.field}`,
        ),
    )
}

function compileTraceFilters(filters: readonly CanonicalTraceFilter[]): TelemetryFilter[] {
    return filters.map((filter) => {
        if (filter.field === 'status') return compileTraceStatus(filter)
        const key =
            filter.field === 'durationMs'
                ? '$metadata.traceDuration'
                : filter.field === 'name'
                  ? '$metadata.spanName'
                  : filter.field.startsWith('attributes.')
                    ? `$metadata.${filter.field.slice('attributes.'.length)}`
                    : `$metadata.${filter.field}`
        return compileTelemetryFilter(filter, key)
    })
}

function compileTraceStatus(filter: CanonicalTraceFilter): TelemetryFilter {
    if (
        (filter.operator !== 'eq' && filter.operator !== 'ne') ||
        (filter.value !== 'ok' && filter.value !== 'error')
    ) {
        throw new InsightError(
            'UNSUPPORTED_OPERATION',
            'Cloudflare supports only eq/ne ok/error Trace status filters',
        )
    }
    const exists =
        (filter.operator === 'eq' && filter.value === 'error') ||
        (filter.operator === 'ne' && filter.value === 'ok')
    return {
        key: '$metadata.error',
        kind: 'filter',
        operation: exists ? 'exists' : 'is_null',
        type: 'string',
    }
}

function compileTelemetryFilter(
    filter: CanonicalLogFilter | CanonicalTraceFilter,
    key: string,
): TelemetryFilter {
    const values = Array.isArray(filter.value) ? filter.value : [filter.value]
    if (values.length === 0 || values.some((value) => value === null)) {
        throw new InsightError(
            'UNSUPPORTED_OPERATION',
            `Cloudflare cannot represent ${filter.field} ${filter.operator}`,
        )
    }
    const type = typeof values[0]
    if (
        !['boolean', 'number', 'string'].includes(type) ||
        values.some((value) => typeof value !== type)
    ) {
        throw new InsightError(
            'UNSUPPORTED_OPERATION',
            `Cloudflare requires one scalar type for ${filter.field}`,
        )
    }
    const operation =
        filter.operator === 'ne'
            ? 'neq'
            : filter.operator === 'notIn'
              ? 'not_in'
              : filter.operator === 'in'
                ? 'in'
                : filter.operator
    return telemetryFilter(key, operation, values.length === 1 ? values[0]! : values.join(','))
}

function telemetryFilter(
    key: string,
    operation: string,
    value: boolean | number | string,
): TelemetryFilter {
    const type = typeof value
    if (type !== 'boolean' && type !== 'number' && type !== 'string') {
        throw new TypeError('Cloudflare telemetry filters require scalar values')
    }
    return { key, kind: 'filter', operation, type, value }
}

function logRecord(value: unknown): LogRecord {
    const event = record(value)
    const metadata = record(event?.$metadata)
    if (
        !event ||
        !metadata ||
        typeof metadata.id !== 'string' ||
        number(event.timestamp) === null
    ) {
        throw new CloudflareApiError('Cloudflare Workers Logs returned a malformed event', 502)
    }
    const attributes = Object.fromEntries(
        Object.entries(metadata).filter(
            ([key]) => !['id', 'level', 'message', 'service', 'spanId', 'traceId'].includes(key),
        ),
    )
    if (typeof event.dataset === 'string') attributes.dataset = event.dataset
    const workers = record(event.$workers)
    if (workers) attributes.workers = workers
    return {
        ...(Object.keys(attributes).length > 0 ? { attributes } : {}),
        ...(event.source !== undefined
            ? { body: event.source }
            : metadata.message !== undefined
              ? { body: metadata.message }
              : metadata.error !== undefined
                ? { body: metadata.error }
                : {}),
        id: metadata.id,
        ...(typeof metadata.service === 'string' ? { service: metadata.service } : {}),
        ...logSeverity(metadata.level),
        ...(typeof metadata.spanId === 'string' ? { spanId: metadata.spanId } : {}),
        timestamp: new Date(number(event.timestamp)!).toISOString(),
        ...(typeof metadata.traceId === 'string' ? { traceId: metadata.traceId } : {}),
    }
}

function logSeverity(value: unknown): { severity?: LogSeverity; severityText?: string } {
    if (typeof value !== 'string') return {}
    const normalized = value.toLowerCase()
    const severity =
        normalized === 'log'
            ? 'info'
            : normalized === 'warning'
              ? 'warn'
              : normalized === 'critical'
                ? 'fatal'
                : normalized
    if (severity === 'trace') return { severity: 'trace', severityText: value }
    if (severity === 'debug') return { severity: 'debug', severityText: value }
    if (severity === 'info') return { severity: 'info', severityText: value }
    if (severity === 'warn') return { severity: 'warn', severityText: value }
    if (severity === 'error') return { severity: 'error', severityText: value }
    if (severity === 'fatal') return { severity: 'fatal', severityText: value }
    return { severityText: value }
}

function traceRecord(value: unknown): TraceRecord {
    const trace = record(value)
    const start = number(trace?.traceStartMs)
    const end = number(trace?.traceEndMs)
    const duration = number(trace?.traceDurationMs)
    const services = Array.isArray(trace?.service)
        ? trace.service.filter((service): service is string => typeof service === 'string')
        : undefined
    if (
        !trace ||
        typeof trace.traceId !== 'string' ||
        start === null ||
        end === null ||
        duration === null ||
        !services ||
        number(trace.spans) === null
    ) {
        throw new CloudflareApiError('Cloudflare Workers Traces returned a malformed trace', 502)
    }
    const errors = Array.isArray(trace.errors)
        ? trace.errors.filter((error): error is string => typeof error === 'string')
        : []
    const status: TraceStatus = errors.length > 0 ? 'error' : 'ok'
    return {
        attributes: {
            ...(errors.length > 0 ? { errors } : {}),
            ...(typeof trace.rootSpanName === 'string' ? { rootSpanName: trace.rootSpanName } : {}),
            services,
        },
        durationMs: duration,
        endTime: new Date(end).toISOString(),
        ...(typeof trace.rootTransactionName === 'string'
            ? { name: trace.rootTransactionName }
            : typeof trace.rootSpanName === 'string'
              ? { name: trace.rootSpanName }
              : {}),
        ...(services.length === 1 ? { service: services[0] } : {}),
        spanCount: number(trace.spans)!,
        startTime: new Date(start).toISOString(),
        status,
        traceId: trace.traceId,
    }
}

function telemetryGranularity(query: ResolvedMetricQuery): number | undefined {
    if (query.grain === 'auto') return undefined
    if (query.grain === 'month' || query.grain === 'year') {
        throw new InsightError(
            'UNSUPPORTED_OPERATION',
            `Cloudflare Workers metrics do not support ${query.grain} buckets`,
        )
    }
    const duration = new Date(query.range.to).valueOf() - new Date(query.range.from).valueOf()
    const interval = {
        minute: 60_000,
        hour: 3_600_000,
        day: 86_400_000,
        week: 604_800_000,
    }[query.grain]
    return Math.max(1, Math.ceil(duration / interval))
}

function qualityOutput(
    payload: unknown,
    truncated = false,
    resultSampleInterval = 1,
): Pick<LogAdapterOutput, 'quality'> {
    const response = record(payload)
    const result = record(response?.result)
    const statistics = record(result?.statistics)
    const run = record(result?.run)
    const interval = Math.max(number(statistics?.abr_level) ?? 1, resultSampleInterval)
    const errors = graphqlErrors(payload)
    const partial = truncated || errors.length > 0 || (run?.status && run.status !== 'COMPLETED')
    const warnings = [
        ...errors.map((error) => ({
            code: String(error.extensions?.code ?? error.code ?? 'cloudflare-telemetry-error'),
            message: error.message ?? 'Cloudflare returned a telemetry error',
        })),
        ...(truncated
            ? [
                  {
                      code: 'cloudflare-log-truncated',
                      message: 'Cloudflare truncated at least one Workers log event',
                  },
              ]
            : []),
    ]
    if (interval <= 1 && !partial && warnings.length === 0) return {}
    return {
        quality: {
            ...(interval > 1 ? { approximate: true, sampleRate: 1 / interval, sampled: true } : {}),
            ...(partial ? { partial: true } : {}),
            ...(warnings.length > 0 ? { warnings } : {}),
        },
    }
}

function isTruncatedEvent(value: unknown): boolean {
    const event = record(value)
    return record(event?.$workers)?.truncated === true
}

function analyticsEngineSink(binding: CloudflareAnalyticsEngineBinding): EventDestination {
    const encoder = new TextEncoder()
    return {
        track(event: Event): void {
            if (event.name.length === 0) {
                throw new TypeError('Analytics event name cannot be empty')
            }
            const index = `name:${event.name}`
            if (encoder.encode(index).byteLength > MAX_INDEX_BYTES) {
                throw new RangeError(`Analytics Engine index exceeds ${MAX_INDEX_BYTES} bytes`)
            }
            let properties: string
            try {
                properties = JSON.stringify(event.properties ?? {})
            } catch (error) {
                throw new TypeError('Analytics event properties must be JSON serializable', {
                    cause: error,
                })
            }
            const blobs = [event.name, properties, event.origin]
            const blobBytes = blobs.reduce(
                (total, blob) => total + encoder.encode(blob).byteLength,
                0,
            )
            if (blobBytes > MAX_BLOB_BYTES) {
                throw new RangeError(`Analytics Engine blobs exceed ${MAX_BLOB_BYTES} bytes`)
            }
            binding.writeDataPoint({ blobs, indexes: [index] })
        },
    }
}

interface AnalyticsEngineReadOptions {
    accountId?: string
    apiToken?: string
    dataset: string
    fetch?: Fetch
    now?: () => Date
}

function analyticsEngineAdapter(options: AnalyticsEngineReadOptions) {
    if (!/^[A-Za-z_][A-Za-z0-9_]*$/.test(options.dataset)) {
        throw new TypeError('Analytics Engine dataset must be a SQL identifier')
    }
    const fetcher = options.fetch ?? globalThis.fetch
    const now = options.now ?? (() => new Date())
    const validate = (query: ResolvedMetricQuery): void => {
        if (query.metrics.length !== 1 || query.metrics[0] !== 'events') {
            throw new TypeError('Analytics Engine supports only the events metric')
        }
        const dimensions = query.dimensions.join(',')
        if (!['', 'time', 'name'].includes(dimensions)) {
            throw new TypeError(
                'Analytics Engine supports scalar, time series, or name breakdown queries',
            )
        }
        if (query.timezone !== 'UTC') {
            throw new TypeError('Analytics Engine currently supports UTC query buckets only')
        }
        const earliest = new Date(now().getTime())
        earliest.setUTCMonth(earliest.getUTCMonth() - 3)
        if (new Date(query.range.from) < earliest) {
            throw new RangeError(
                'Analytics Engine queries cannot start beyond its 3-month retention',
            )
        }
        compileEngineNameFilter(query.where)
    }

    const execute = async (
        query: ResolvedMetricQuery,
        signal?: AbortSignal,
    ): Promise<MetricAdapterOutput> => {
        if (!options.accountId || !options.apiToken) {
            throw new InsightError(
                'CONFIGURATION_MISSING',
                'Cloudflare Analytics Engine credentials are missing',
            )
        }
        validate(query)
        const response = await fetchWithRetry(
            fetcher,
            `${ANALYTICS_ENGINE_ENDPOINT}/${encodeURIComponent(options.accountId)}/analytics_engine/sql`,
            {
                body: analyticsEngineSql(options.dataset, query),
                headers: { authorization: `Bearer ${options.apiToken}` },
                method: 'POST',
                ...(signal ? { signal } : {}),
            },
        )
        const payload = await readJson(response, 'Cloudflare Analytics Engine')
        if (!response.ok) {
            throw apiError(payload, response.status, 'Cloudflare Analytics Engine query failed')
        }
        const data = record(payload)?.data
        if (!Array.isArray(data)) {
            throw new CloudflareApiError('Cloudflare Analytics Engine returned malformed data', 502)
        }
        if (!data.every((row) => isAnalyticsEngineRow(row, query))) {
            throw new CloudflareApiError('Cloudflare Analytics Engine returned malformed rows', 502)
        }
        return analyticsEngineReport(query, data)
    }

    return defineMetricAdapter({
        dimensions: {
            name: { operators: ['eq'], type: 'string' },
            time: { operators: [], type: 'datetime' },
        },
        history: { grain: 'day' },
        metrics: {
            events: {
                aggregation: { kind: 'count' },
                rollup: 'additive',
                unit: '{event}',
            },
        },
        execute: (query, { signal }) =>
            execute(resolvedMetricQuery('cloudflare.analyticsEngine', query, 'time'), signal),
    })
}

function analyticsEngineSql(dataset: string, query: ResolvedMetricQuery): string {
    const from = sqlDate(query.range.from)
    const to = sqlDate(query.range.to)
    const nameFilter = compileEngineNameFilter(query.where)
    const where = [
        `timestamp >= toDateTime('${from}')`,
        `timestamp < toDateTime('${to}')`,
        ...(nameFilter === undefined ? [] : [`blob1 = '${sqlString(nameFilter)}'`]),
    ].join(' AND ')
    const limit = Math.max(1, query.limit ?? 10_000)

    if (query.dimensions.length === 0) {
        return `SELECT SUM(_sample_interval) AS events, MAX(_sample_interval) AS sampleInterval FROM ${dataset} WHERE ${where} FORMAT JSON`
    }
    if (query.dimensions[0] === 'name') {
        return `SELECT blob1 AS name, SUM(_sample_interval) AS events, MAX(_sample_interval) AS sampleInterval FROM ${dataset} WHERE ${where} GROUP BY blob1 ORDER BY events DESC LIMIT ${limit} FORMAT JSON`
    }
    const unit = engineInterval(query.grain)
    return `SELECT toStartOfInterval(timestamp, INTERVAL '1' ${unit}) AS time, SUM(_sample_interval) AS events, MAX(_sample_interval) AS sampleInterval FROM ${dataset} WHERE ${where} GROUP BY time ORDER BY time ASC LIMIT ${limit} FORMAT JSON`
}

function analyticsEngineReport(query: ResolvedMetricQuery, data: unknown[]): MetricAdapterOutput {
    const rows = data.map((item) => record(item) ?? {})
    let maxInterval = 1
    let total = 0
    const points: MetricAdapterPoint[] = []
    const dimension = query.dimensions[0]
    for (const row of rows) {
        maxInterval = Math.max(maxInterval, number(row.sampleInterval) ?? 1)
        total += number(row.events) ?? 0
        if (dimension === 'time') {
            points.push({ time: text(row.time), values: { events: number(row.events) } })
        } else if (dimension === 'name') {
            points.push({
                dimensions: { name: typeof row.name === 'string' ? row.name : null },
                values: { events: number(row.events) },
            })
        }
    }
    const meta = reportMeta(
        query,
        maxInterval > 1 ? { approximate: true, sampled: true, sampleRate: 1 / maxInterval } : {},
    )
    if (query.dimensions.length === 0) {
        return { ...meta, values: { events: number(rows[0]?.events) } }
    }
    return { ...meta, points, values: { events: total } }
}

function validateWebQuery(query: ResolvedMetricQuery): void {
    if (query.timezone !== 'UTC') {
        throw new TypeError('Cloudflare Web Analytics currently supports UTC query buckets only')
    }
    for (const metric of query.metrics) {
        if (!['pageViews', 'visits'].includes(metric)) {
            throw new TypeError(`Unsupported Cloudflare Web Analytics metric: ${metric}`)
        }
    }
    for (const dimension of query.dimensions) {
        if (dimension !== 'time' && !Object.hasOwn(webDimensionFields, dimension)) {
            throw new TypeError(`Unsupported Cloudflare Web Analytics dimension: ${dimension}`)
        }
    }
    compileWebFilter(query.where)
}

function webGraphqlQuery(query: ResolvedMetricQuery, timeField: string | undefined): string {
    const dimensions = query.dimensions
        .map((dimension) => {
            if (dimension === 'time') {
                if (timeField === undefined)
                    throw new TypeError('A time dimension requires a time field')
                return `time: ${timeField}`
            }
            if (!isWebDimension(dimension)) {
                throw new TypeError(`Unsupported Cloudflare Web Analytics dimension: ${dimension}`)
            }
            return `${dimension}: ${webDimensionFields[dimension]}`
        })
        .join('\n')
    const metrics = [
        ...(query.metrics.includes('pageViews') ? ['count'] : []),
        ...(query.metrics.includes('visits') ? ['sum { visits }'] : []),
    ].join('\n')
    const orderBy =
        timeField === undefined
            ? query.metrics[0] === 'visits'
                ? 'sum_visits_DESC'
                : 'count_DESC'
            : `${timeField}_ASC`
    return `query WebAnalytics($accountTag: String!, $filter: AccountRumPageloadEventsAdaptiveGroupsFilter_InputObject!, $limit: Int!) {
  viewer {
    accounts(filter: { accountTag: $accountTag }) {
      rows: rumPageloadEventsAdaptiveGroups(filter: $filter, limit: $limit, orderBy: [${orderBy}]) {
        ${metrics}
        avg { sampleInterval }
        ${dimensions.length === 0 ? '' : `dimensions { ${dimensions} }`}
      }
    }
  }
}`
}

function webTimeField(grain: ResolvedMetricQuery['grain']): string {
    if (grain === 'minute') return 'datetimeMinute'
    if (grain === 'hour') return 'datetimeHour'
    return 'date'
}

function compileWebFilter(filter: CanonicalWhere | undefined): Record<string, unknown> | undefined {
    if (filter === undefined) return undefined
    if ('filters' in filter) {
        return {
            [filter.operator === 'and' ? 'AND' : 'OR']: filter.filters.map((item) =>
                compileWebFilter(item),
            ),
        }
    }
    if ('filter' in filter) {
        throw new TypeError('Cloudflare Web Analytics does not support generic NOT filters')
    }
    if (filter.field === 'time' || !isWebDimension(filter.field)) {
        throw new TypeError(`Unsupported Cloudflare Web Analytics filter: ${filter.field}`)
    }
    const field = webDimensionFields[filter.field]
    const suffix = webFilterSuffix(filter.operator)
    if (suffix === undefined) {
        throw new TypeError(
            `Unsupported Cloudflare Web Analytics filter operator: ${filter.operator}`,
        )
    }
    const arrayOperator = filter.operator === 'in' || filter.operator === 'notIn'
    if (arrayOperator) {
        if (
            !Array.isArray(filter.value) ||
            filter.value.length === 0 ||
            !filter.value.every((value) => typeof value === 'string')
        ) {
            throw new TypeError(
                `Cloudflare Web Analytics ${filter.operator} filters require a non-empty string array`,
            )
        }
    } else if (typeof filter.value !== 'string') {
        throw new TypeError(
            `Cloudflare Web Analytics ${filter.operator} filters require a string value`,
        )
    }
    return { [`${field}${suffix}`]: filter.value }
}

function compileEngineNameFilter(filter: CanonicalWhere | undefined): string | undefined {
    if (filter === undefined) return undefined
    if ('field' in filter && filter.field === 'name' && filter.operator === 'eq') {
        if (typeof filter.value !== 'string') {
            throw new TypeError('Analytics Engine name filter must be a string')
        }
        return filter.value
    }
    throw new TypeError('Analytics Engine supports only an equality filter on event name')
}

function webReport(
    query: ResolvedMetricQuery,
    input: WebAnalyticsRow[],
    errors: GraphQLErrorShape[],
    nativeLimit: number,
): MetricAdapterOutput {
    const rows = rollupWebRows(query, input)
    const limited = query.limit === undefined ? rows : rows.slice(0, query.limit)
    let maxInterval = 1
    for (const row of input) {
        maxInterval = Math.max(maxInterval, number(row.avg?.sampleInterval) ?? 1)
    }
    const partial = errors.length > 0 || input.length === nativeLimit
    const warnings = [
        ...errors.map((error) => ({
            code: String(error.extensions?.code ?? error.code ?? 'cloudflare-graphql-error'),
            message: error.message ?? 'Cloudflare returned a GraphQL error',
        })),
        ...(input.length === nativeLimit
            ? [
                  {
                      code: 'cloudflare-row-limit',
                      message: `Cloudflare returned the maximum ${nativeLimit} rows; results may be incomplete`,
                  },
              ]
            : []),
    ]
    const meta = reportMeta(query, {
        ...(maxInterval > 1 ? { approximate: true } : {}),
        ...(maxInterval > 1 ? { sampled: true } : {}),
        ...(maxInterval > 1 ? { sampleRate: 1 / maxInterval } : {}),
        ...(partial ? { partial: true } : {}),
        ...(warnings.length === 0 ? {} : { warnings }),
    })

    if (query.dimensions.length === 0) {
        return { ...meta, values: sumWebMetrics(query.metrics, limited) }
    }
    const hasTimeDimension = query.dimensions.includes('time')
    const dimensions = query.dimensions.filter((dimension) => dimension !== 'time')
    return {
        ...meta,
        points: limited.map((row) => ({
            ...(hasTimeDimension ? { time: text(row.dimensions?.time) } : {}),
            ...(dimensions.length === 0
                ? {}
                : {
                      dimensions: Object.fromEntries(
                          dimensions.map((dimension) => [
                              dimension,
                              dimensionValue(row.dimensions?.[dimension]),
                          ]),
                      ),
                  }),
            values: webMetricValues(query.metrics, row),
        })),
        values: sumWebMetrics(query.metrics, limited),
    }
}

function rollupWebRows(query: ResolvedMetricQuery, rows: WebAnalyticsRow[]): WebAnalyticsRow[] {
    if (!query.dimensions.includes('time') || !['week', 'month', 'year'].includes(query.grain)) {
        return rows
    }
    const groups = new Map<string, WebAnalyticsRow>()
    for (const row of rows) {
        const dimensions: Record<string, unknown> = {
            ...row.dimensions,
            time: bucketTime(row.dimensions?.time, query.grain),
        }
        const key = JSON.stringify(query.dimensions.map((dimension) => dimensions[dimension]))
        const existing = groups.get(key)
        if (existing === undefined) {
            groups.set(key, {
                count: number(row.count) ?? 0,
                dimensions,
                sum: { visits: number(row.sum?.visits) ?? 0 },
            })
        } else {
            existing.count = (number(existing.count) ?? 0) + (number(row.count) ?? 0)
            if (existing.sum !== undefined) {
                existing.sum.visits =
                    (number(existing.sum.visits) ?? 0) + (number(row.sum?.visits) ?? 0)
            }
        }
    }
    return [...groups.values()]
}

function bucketTime(value: unknown, grain: ResolvedMetricQuery['grain']): string {
    const date = new Date(text(value))
    if (Number.isNaN(date.getTime())) return text(value)
    if (grain === 'week') {
        const day = date.getUTCDay() || 7
        date.setUTCDate(date.getUTCDate() - day + 1)
    } else if (grain === 'month') {
        date.setUTCDate(1)
    } else if (grain === 'year') {
        date.setUTCMonth(0, 1)
    }
    return date.toISOString().slice(0, 10)
}

function webMetricValues(metrics: readonly string[], row: WebAnalyticsRow): MetricValues {
    return Object.fromEntries(
        metrics.map((metric) => [
            metric,
            metric === 'pageViews' ? number(row.count) : number(row.sum?.visits),
        ]),
    )
}

function sumWebMetrics(metrics: readonly string[], rows: WebAnalyticsRow[]): MetricValues {
    let pageViews = 0
    let visits = 0
    for (const row of rows) {
        pageViews += number(row.count) ?? 0
        visits += number(row.sum?.visits) ?? 0
    }
    return Object.fromEntries(
        metrics.map((metric) => [metric, metric === 'pageViews' ? pageViews : visits]),
    )
}

function reportMeta(
    query: ResolvedMetricQuery,
    quality: NonNullable<MetricAdapterOutput['quality']>,
): Pick<MetricAdapterOutput, 'meta' | 'quality'> {
    return {
        quality,
        meta: {
            temporal: {
                bucketTimezone: query.timezone,
                ...(query.grain === 'auto' ? {} : { grain: query.grain }),
                sourceTimezone: 'UTC',
            },
        },
    }
}

async function readJson(response: Response, provider: string): Promise<unknown> {
    try {
        return await response.json()
    } catch {
        throw new CloudflareApiError(`${provider} returned invalid JSON`, response.status)
    }
}

function apiError(payload: unknown, status: number, fallback: string): CloudflareApiError {
    const errors = graphqlErrors(payload)
    const first = errors[0]
    const response = record(payload)
    const message =
        first?.message ??
        (typeof response?.message === 'string' ? response.message : undefined) ??
        `${fallback} (${status})`
    return new CloudflareApiError(message, status, first?.extensions?.code ?? first?.code)
}

function graphqlErrors(payload: unknown): GraphQLErrorShape[] {
    const errors = record(payload)?.errors
    if (!Array.isArray(errors)) return []
    return errors.map((error) => {
        const item = record(error)
        const extensions = record(item?.extensions)
        return {
            ...(typeof item?.code === 'string' || typeof item?.code === 'number'
                ? { code: item.code }
                : {}),
            ...(typeof item?.message === 'string' ? { message: item.message } : {}),
            ...(typeof extensions?.code === 'string' || typeof extensions?.code === 'number'
                ? { extensions: { code: extensions.code } }
                : {}),
        }
    })
}

function webRows(payload: unknown): WebAnalyticsRow[] | undefined {
    const data = record(payload)?.data
    const viewer = record(record(data)?.viewer)
    const accounts = viewer?.accounts
    if (!Array.isArray(accounts) || accounts.length === 0) return undefined
    const rows = record(accounts[0])?.rows
    return Array.isArray(rows) ? rows : undefined
}

function record(value: unknown): Record<string, unknown> | undefined {
    return isRecord(value) ? value : undefined
}

function isRecord(value: unknown): value is Record<string, unknown> {
    return typeof value === 'object' && value !== null && !Array.isArray(value)
}

function isWebAnalyticsRow(value: unknown, query: ResolvedMetricQuery): value is WebAnalyticsRow {
    if (!isRecord(value)) return false
    const average = record(value.avg)
    if (number(average?.sampleInterval) === null) return false
    if (query.metrics.includes('pageViews') && number(value.count) === null) return false
    if (query.metrics.includes('visits') && number(record(value.sum)?.visits) === null) {
        return false
    }
    if (query.dimensions.length === 0) return true
    const dimensions = record(value.dimensions)
    return (
        dimensions !== undefined &&
        query.dimensions.every(
            (dimension) =>
                typeof dimensions[dimension] === 'string' && dimensions[dimension].length > 0,
        )
    )
}

function isAnalyticsEngineRow(value: unknown, query: ResolvedMetricQuery): boolean {
    if (
        !isRecord(value) ||
        number(value.events) === null ||
        number(value.sampleInterval) === null
    ) {
        return false
    }
    if (query.dimensions[0] === 'name') return typeof value.name === 'string'
    if (query.dimensions[0] === 'time') {
        return typeof value.time === 'string' && Number.isFinite(new Date(value.time).valueOf())
    }
    return true
}

function isWebDimension(value: string): value is keyof typeof webDimensionFields {
    return Object.hasOwn(webDimensionFields, value)
}

function number(value: unknown): number | null {
    if (typeof value === 'number' && Number.isFinite(value)) return value
    if (typeof value === 'string' && value.trim() !== '') {
        const parsed = Number(value)
        if (Number.isFinite(parsed)) return parsed
    }
    return null
}

function dimensionValue(value: unknown): DimensionValue {
    return typeof value === 'string' || typeof value === 'number' || typeof value === 'boolean'
        ? value
        : null
}

function text(value: unknown): string {
    if (typeof value === 'string') return value
    if (typeof value === 'number' || typeof value === 'boolean') return String(value)
    return ''
}

function webFilterSuffix(
    operator: Extract<CanonicalWhere, { field: string }>['operator'],
): string | undefined {
    if (operator === 'eq') return ''
    if (operator === 'in') return '_in'
    if (operator === 'ne') return '_neq'
    if (operator === 'notIn') return '_notin'
    return undefined
}

function sqlDate(value: string): string {
    const date = new Date(value)
    if (Number.isNaN(date.getTime())) throw new TypeError(`Invalid Analytics Engine date: ${value}`)
    return date.toISOString().slice(0, 19).replace('T', ' ')
}

function sqlString(value: string): string {
    return value.replaceAll('\\', '\\\\').replaceAll("'", "\\'")
}

function engineInterval(grain: ResolvedMetricQuery['grain']): string {
    if (grain === 'auto') return 'DAY'
    return grain.toUpperCase()
}
