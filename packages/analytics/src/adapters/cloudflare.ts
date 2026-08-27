import { withArchiveProviderMetadata } from '../core/archive-metadata.ts'
import type {
    AnalyticsAdapter,
    AnalyticsAdapterBundle,
    AnalyticsEvent,
    AnalyticsEventSink,
    AnalyticsFilter,
    AnalyticsFilterValue,
    AnalyticsMetricValues,
    AnalyticsReport,
    AnalyticsReportMeta,
    ResolvedAnalyticsQuery,
} from '../core/types.ts'
import { fetchWithRetry } from './fetch-with-retry.ts'

const GRAPHQL_ENDPOINT = 'https://api.cloudflare.com/client/v4/graphql'
const ANALYTICS_ENGINE_ENDPOINT = 'https://api.cloudflare.com/client/v4/accounts'
const MAX_GRAPHQL_ROWS = 10_000
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

export class CloudflareApiError extends Error {
    readonly code: number | string | undefined
    readonly status: number

    constructor(message: string, status: number, code?: number | string) {
        super(message)
        this.name = 'CloudflareApiError'
        this.status = status
        this.code = code
    }
}

export interface CloudflareWebAnalyticsOptions {
    accountId: string
    apiToken: string
    datasetId?: string
    fetch?: Fetch
    siteTag: string
}

export interface CloudflareAnalyticsEngineBinding {
    writeDataPoint(point: { blobs?: string[]; doubles?: number[]; indexes?: string[] }): void
}

export type CloudflareAnalyticsEngineEvent = AnalyticsEvent
export type CloudflareAnalyticsEngineSink = AnalyticsEventSink

export interface CloudflareAnalyticsEngineOptions {
    accountId?: string
    apiToken?: string
    binding?: CloudflareAnalyticsEngineBinding
    dataset?: string
    datasetId?: string
    fetch?: Fetch
    now?: () => Date
}

export interface CloudflareAnalyticsEngineResource {
    adapter?: AnalyticsAdapter
    sink?: CloudflareAnalyticsEngineSink
}

export interface CloudflareOptions {
    analyticsEngine?: CloudflareAnalyticsEngineOptions
    webAnalytics?: CloudflareWebAnalyticsOptions
}

export type CloudflareProvider = AnalyticsAdapterBundle

export function cloudflareWebAnalytics(options: CloudflareWebAnalyticsOptions): AnalyticsAdapter {
    const fetcher = options.fetch ?? globalThis.fetch
    const datasetId = options.datasetId ?? 'cloudflare.web-analytics'

    return withArchiveProviderMetadata(
        {
            dataset: {
                archive: [
                    {
                        dimensions: ['time'],
                        grain: 'day',
                        id: 'daily-traffic',
                        metrics: ['pageViews', 'visits'],
                    },
                ],
                dimensions: [
                    { id: 'time', valueType: 'datetime' },
                    ...Object.keys(webDimensionFields).map((id) => ({
                        id,
                        valueType: 'string' as const,
                    })),
                ],
                domain: 'traffic',
                id: datasetId,
                metrics: [
                    {
                        aggregation: 'sum',
                        id: 'pageViews',
                        rollup: 'additive',
                        valueType: 'integer',
                    },
                    {
                        aggregation: 'sum',
                        id: 'visits',
                        rollup: 'additive',
                        valueType: 'integer',
                    },
                ],
            },
            async query(query: ResolvedAnalyticsQuery): Promise<AnalyticsReport> {
                validateWebQuery(query)
                const timeField = query.dimensions.includes('time')
                    ? webTimeField(query.grain)
                    : undefined
                const nativeLimit =
                    timeField === 'date' && !['auto', 'day'].includes(query.grain)
                        ? MAX_GRAPHQL_ROWS
                        : Math.min(query.limit ?? MAX_GRAPHQL_ROWS, MAX_GRAPHQL_ROWS)
                const providerFilter = compileWebFilter(query.filters)
                const filter = {
                    AND: [
                        {
                            datetime_geq: query.range.from,
                            datetime_lt: query.range.to,
                            siteTag: options.siteTag,
                        },
                        ...(providerFilter === undefined ? [] : [providerFilter]),
                    ],
                }
                const body = JSON.stringify({
                    query: webGraphqlQuery(query, timeField),
                    variables: { accountTag: options.accountId, filter, limit: nativeLimit },
                })
                const response = await fetchWithRetry(fetcher, GRAPHQL_ENDPOINT, {
                    body,
                    headers: {
                        accept: 'application/json',
                        authorization: `Bearer ${options.apiToken}`,
                        'content-type': 'application/json',
                    },
                    method: 'POST',
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
                    throw new CloudflareApiError(
                        'Cloudflare Web Analytics returned malformed rows',
                        502,
                    )
                }
                if (errors.length > 0 && rows.length === 0) {
                    throw apiError(payload, response.status, 'Cloudflare GraphQL query failed')
                }

                return webReport(query, rows, errors, nativeLimit)
            },
            validate: validateWebQuery,
        },
        { finalizationDelay: '1d', initialLookbackMonths: 6 },
    )
}

export function cloudflareAnalyticsEngine(
    options: CloudflareAnalyticsEngineOptions,
): CloudflareAnalyticsEngineResource {
    const hasAnyReadOption =
        options.accountId !== undefined ||
        options.apiToken !== undefined ||
        options.dataset !== undefined
    const hasAllReadOptions =
        options.accountId !== undefined &&
        options.apiToken !== undefined &&
        options.dataset !== undefined
    if (hasAnyReadOption && !hasAllReadOptions) {
        throw new TypeError('Analytics Engine reads require accountId, apiToken, and dataset')
    }
    if (!hasAllReadOptions && options.binding === undefined) {
        throw new TypeError('Analytics Engine requires read credentials or a binding')
    }

    const resource: CloudflareAnalyticsEngineResource = {}
    if (
        options.accountId !== undefined &&
        options.apiToken !== undefined &&
        options.dataset !== undefined
    ) {
        resource.adapter = analyticsEngineAdapter({
            accountId: options.accountId,
            apiToken: options.apiToken,
            dataset: options.dataset,
            ...(options.datasetId === undefined ? {} : { datasetId: options.datasetId }),
            ...(options.fetch === undefined ? {} : { fetch: options.fetch }),
            ...(options.now === undefined ? {} : { now: options.now }),
        })
    }
    if (options.binding !== undefined) {
        resource.sink = analyticsEngineSink(options.binding)
    }
    return resource
}

export function cloudflare(options: CloudflareOptions): CloudflareProvider {
    const adapters: AnalyticsAdapter[] = []
    if (options.webAnalytics !== undefined) {
        adapters.push(cloudflareWebAnalytics(options.webAnalytics))
    }
    const engine =
        options.analyticsEngine === undefined
            ? undefined
            : cloudflareAnalyticsEngine(options.analyticsEngine)
    if (engine?.adapter !== undefined) {
        adapters.push(engine.adapter)
    }
    return engine?.sink === undefined ? { adapters } : { adapters, eventSink: engine.sink }
}

function analyticsEngineSink(
    binding: CloudflareAnalyticsEngineBinding,
): CloudflareAnalyticsEngineSink {
    const encoder = new TextEncoder()
    return {
        track(event: CloudflareAnalyticsEngineEvent): void {
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
    accountId: string
    apiToken: string
    dataset: string
    datasetId?: string
    fetch?: Fetch
    now?: () => Date
}

function analyticsEngineAdapter(options: AnalyticsEngineReadOptions): AnalyticsAdapter {
    if (!/^[A-Za-z_][A-Za-z0-9_]*$/.test(options.dataset)) {
        throw new TypeError('Analytics Engine dataset must be a SQL identifier')
    }
    const fetcher = options.fetch ?? globalThis.fetch
    const now = options.now ?? (() => new Date())
    const datasetId = options.datasetId ?? `cloudflare.analytics-engine.${options.dataset}`
    const validate = (query: ResolvedAnalyticsQuery): void => {
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
        compileEngineNameFilter(query.filters)
    }

    return withArchiveProviderMetadata(
        {
            dataset: {
                archive: [
                    { dimensions: ['time'], grain: 'day', id: 'daily-events', metrics: ['events'] },
                ],
                dimensions: [
                    { id: 'time', valueType: 'datetime' },
                    { id: 'name', valueType: 'string' },
                ],
                domain: 'product',
                id: datasetId,
                metrics: [
                    {
                        aggregation: 'count',
                        id: 'events',
                        rollup: 'additive',
                        valueType: 'integer',
                    },
                ],
            },
            async query(query: ResolvedAnalyticsQuery): Promise<AnalyticsReport> {
                validate(query)
                const sql = analyticsEngineSql(options.dataset, query)
                const response = await fetchWithRetry(
                    fetcher,
                    `${ANALYTICS_ENGINE_ENDPOINT}/${encodeURIComponent(options.accountId)}/analytics_engine/sql`,
                    {
                        body: sql,
                        headers: { authorization: `Bearer ${options.apiToken}` },
                        method: 'POST',
                    },
                )
                const payload = await readJson(response, 'Cloudflare Analytics Engine')
                if (!response.ok) {
                    throw apiError(
                        payload,
                        response.status,
                        'Cloudflare Analytics Engine query failed',
                    )
                }
                const data = record(payload)?.data
                if (!Array.isArray(data)) {
                    throw new CloudflareApiError(
                        'Cloudflare Analytics Engine returned malformed data',
                        502,
                    )
                }
                if (!data.every((row) => isAnalyticsEngineRow(row, query))) {
                    throw new CloudflareApiError(
                        'Cloudflare Analytics Engine returned malformed rows',
                        502,
                    )
                }
                return analyticsEngineReport(query, data)
            },
            validate,
        },
        { finalizationDelay: '1d', initialLookbackMonths: 3 },
    )
}

function analyticsEngineSql(dataset: string, query: ResolvedAnalyticsQuery): string {
    const from = sqlDate(query.range.from)
    const to = sqlDate(query.range.to)
    const nameFilter = compileEngineNameFilter(query.filters)
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

function analyticsEngineReport(query: ResolvedAnalyticsQuery, data: unknown[]): AnalyticsReport {
    const rows = data.map((item) => record(item) ?? {})
    const maxInterval = Math.max(1, ...rows.map((row) => number(row.sampleInterval) ?? 1))
    const meta = reportMeta(query, maxInterval > 1 ? { approximate: true, sampled: true } : {})
    if (query.dimensions.length === 0) {
        return { kind: 'scalar', meta, values: { events: number(rows[0]?.events) } }
    }
    if (query.dimensions[0] === 'time') {
        return {
            kind: 'series',
            meta,
            points: rows.map((row) => ({
                time: text(row.time),
                values: { events: number(row.events) },
            })),
        }
    }
    return {
        kind: 'table',
        meta,
        rows: rows.map((row) => ({
            dimensions: { name: typeof row.name === 'string' ? row.name : null },
            metrics: { events: number(row.events) },
        })),
    }
}

function validateWebQuery(query: ResolvedAnalyticsQuery): void {
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
    compileWebFilter(query.filters)
}

function webGraphqlQuery(query: ResolvedAnalyticsQuery, timeField: string | undefined): string {
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

function webTimeField(grain: ResolvedAnalyticsQuery['grain']): string {
    if (grain === 'minute') return 'datetimeMinute'
    if (grain === 'hour') return 'datetimeHour'
    return 'date'
}

function compileWebFilter(
    filter: AnalyticsFilter | undefined,
): Record<string, unknown> | undefined {
    if (filter === undefined) return undefined
    if ('and' in filter) return { AND: filter.and.map((item) => compileWebFilter(item)) }
    if ('or' in filter) return { OR: filter.or.map((item) => compileWebFilter(item)) }
    if ('not' in filter) {
        throw new TypeError('Cloudflare Web Analytics does not support generic NOT filters')
    }
    if (filter.dimension === 'time' || !isWebDimension(filter.dimension)) {
        throw new TypeError(`Unsupported Cloudflare Web Analytics filter: ${filter.dimension}`)
    }
    const field = webDimensionFields[filter.dimension]
    const suffix = webFilterSuffix(filter.operator)
    if (suffix === undefined) {
        throw new TypeError(
            `Unsupported Cloudflare Web Analytics filter operator: ${filter.operator}`,
        )
    }
    const arrayOperator = filter.operator === 'in' || filter.operator === 'not-in'
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

function compileEngineNameFilter(filter: AnalyticsFilter | undefined): string | undefined {
    if (filter === undefined) return undefined
    if ('dimension' in filter && filter.dimension === 'name' && filter.operator === 'eq') {
        if (typeof filter.value !== 'string') {
            throw new TypeError('Analytics Engine name filter must be a string')
        }
        return filter.value
    }
    throw new TypeError('Analytics Engine supports only an equality filter on event name')
}

function webReport(
    query: ResolvedAnalyticsQuery,
    input: WebAnalyticsRow[],
    errors: GraphQLErrorShape[],
    nativeLimit: number,
): AnalyticsReport {
    const rows = rollupWebRows(query, input)
    const limited = query.limit === undefined ? rows : rows.slice(0, query.limit)
    const maxInterval = Math.max(1, ...input.map((row) => number(row.avg?.sampleInterval) ?? 1))
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
        ...(maxInterval > 1 ? { approximate: true, sampled: true } : {}),
        ...(partial ? { partial: true } : {}),
        ...(warnings.length === 0 ? {} : { warnings }),
    })

    if (query.dimensions.length === 0) {
        return { kind: 'scalar', meta, values: sumWebMetrics(query.metrics, limited) }
    }
    if (query.dimensions.length === 1 && query.dimensions[0] === 'time') {
        return {
            kind: 'series',
            meta,
            points: limited.map((row) => ({
                time: text(row.dimensions?.time),
                values: webMetricValues(query.metrics, row),
            })),
        }
    }
    return {
        kind: 'table',
        meta,
        rows: limited.map((row) => ({
            dimensions: Object.fromEntries(
                query.dimensions.map((dimension) => [
                    dimension,
                    filterValue(row.dimensions?.[dimension]),
                ]),
            ),
            metrics: webMetricValues(query.metrics, row),
        })),
    }
}

function rollupWebRows(query: ResolvedAnalyticsQuery, rows: WebAnalyticsRow[]): WebAnalyticsRow[] {
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

function bucketTime(value: unknown, grain: ResolvedAnalyticsQuery['grain']): string {
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

function webMetricValues(metrics: readonly string[], row: WebAnalyticsRow): AnalyticsMetricValues {
    return Object.fromEntries(
        metrics.map((metric) => [
            metric,
            metric === 'pageViews' ? number(row.count) : number(row.sum?.visits),
        ]),
    )
}

function sumWebMetrics(metrics: readonly string[], rows: WebAnalyticsRow[]): AnalyticsMetricValues {
    return Object.fromEntries(
        metrics.map((metric) => [
            metric,
            rows.reduce(
                (total, row) =>
                    total +
                    (metric === 'pageViews'
                        ? (number(row.count) ?? 0)
                        : (number(row.sum?.visits) ?? 0)),
                0,
            ),
        ]),
    )
}

function reportMeta(
    query: ResolvedAnalyticsQuery,
    quality: AnalyticsReportMeta['quality'],
): AnalyticsReportMeta {
    return {
        quality,
        queriedAt: new Date().toISOString(),
        source: query.source,
        temporal: {
            bucketTimezone: query.timezone,
            grain: query.grain,
            sourceTimezone: 'UTC',
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

function isWebAnalyticsRow(
    value: unknown,
    query: ResolvedAnalyticsQuery,
): value is WebAnalyticsRow {
    if (!isRecord(value)) return false
    const average = record(value.avg)
    if (number(average?.sampleInterval) === null) return false
    if (query.metrics.includes('pageViews') && number(value.count) === null) return false
    if (query.metrics.includes('visits') && number(record(value.sum)?.visits) === null) return false
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

function isAnalyticsEngineRow(value: unknown, query: ResolvedAnalyticsQuery): boolean {
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

function filterValue(value: unknown): AnalyticsFilterValue {
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
    operator: Extract<AnalyticsFilter, { dimension: string }>['operator'],
): string | undefined {
    if (operator === 'eq') return ''
    if (operator === 'in') return '_in'
    if (operator === 'neq') return '_neq'
    if (operator === 'not-in') return '_notin'
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

function engineInterval(grain: ResolvedAnalyticsQuery['grain']): string {
    if (grain === 'auto') return 'DAY'
    return grain.toUpperCase()
}
