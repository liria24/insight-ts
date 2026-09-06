import { InsightError, ProviderError } from '../../core/errors.ts'
import {
    defineMetricAdapter,
    type CanonicalWhere,
    type MetricAdapterPoint,
    type MetricAdapterOutput,
    type MetricValues,
} from '../../metrics/index.ts'
import { fetchWithRetry } from '../shared/fetch-with-retry.ts'
import { resolvedMetricQuery, type ResolvedMetricQuery } from '../shared/types.ts'

const SEARCH_ANALYTICS_ENDPOINT = 'https://www.googleapis.com/webmasters/v3/sites'
const PAGE_SIZE = 25_000
const DEFAULT_MAX_ROWS = 250_000
const SEARCH_CONSOLE_TIMEZONE = 'America/Los_Angeles'
const searchConsoleDateFormatter = new Intl.DateTimeFormat('en-CA', {
    day: '2-digit',
    month: '2-digit',
    timeZone: SEARCH_CONSOLE_TIMEZONE,
    year: 'numeric',
})
const searchConsoleDateTimeFormatter = new Intl.DateTimeFormat('en-US', {
    day: '2-digit',
    hour: '2-digit',
    hourCycle: 'h23',
    minute: '2-digit',
    month: '2-digit',
    second: '2-digit',
    timeZone: SEARCH_CONSOLE_TIMEZONE,
    year: 'numeric',
})
const searchConsoleTimeFormatter = new Intl.DateTimeFormat('en-US', {
    hour: '2-digit',
    hourCycle: 'h23',
    minute: '2-digit',
    second: '2-digit',
    timeZone: SEARCH_CONSOLE_TIMEZONE,
})

type Fetch = (input: RequestInfo | URL, init?: RequestInit) => Promise<Response>

const supportedDimensions = [
    'date',
    'hour',
    'query',
    'page',
    'country',
    'device',
    'searchAppearance',
] as const
const supportedFilterDimensions = [
    'country',
    'device',
    'page',
    'query',
    'searchAppearance',
] as const

type DataState = 'all' | 'final' | 'hourly_all'

export class GoogleSearchConsoleApiError extends ProviderError {
    constructor(message: string, status: number, code?: string | number) {
        super('google-search-console', message, {
            ...(code === undefined ? {} : { code }),
            retryable: [429, 500, 502, 503, 504].includes(status),
            status,
        })
        this.name = 'GoogleSearchConsoleApiError'
    }
}

export interface GoogleSearchConsoleOptions {
    advanced?: {
        maxRows?: number
    }
    auth: {
        getAccessToken?(): Promise<string>
    }
    dataState?: DataState
    fetch?: Fetch
    property: string
}

export type GoogleSearchConsoleAdapter = ReturnType<typeof googleSearchConsoleAdapter>
export type GoogleSearchConsoleProvider = ReturnType<typeof googleSearchConsole>

interface SearchAnalyticsRow {
    clicks: number
    ctr: number
    impressions: number
    keys?: readonly string[]
    position: number
}

interface NormalizedSearchAnalyticsRow extends SearchAnalyticsRow {
    keys: readonly string[]
    time?: string
}

interface SearchAnalyticsMetadata {
    first_incomplete_date?: unknown
    first_incomplete_hour?: unknown
}

interface SearchAnalyticsResult {
    executionLimited: boolean
    metadata?: SearchAnalyticsMetadata
    rows: NormalizedSearchAnalyticsRow[]
}

export function googleSearchConsole(options: GoogleSearchConsoleOptions) {
    return {
        id: 'google-search-console',
        adapters: { searchAnalytics: googleSearchConsoleAdapter(options) },
    } as const
}

function googleSearchConsoleAdapter(options: GoogleSearchConsoleOptions) {
    const fetcher = options.fetch ?? globalThis.fetch
    const dataState = options.dataState ?? 'final'
    const maxRows = options.advanced?.maxRows ?? DEFAULT_MAX_ROWS
    if (!Number.isSafeInteger(maxRows) || maxRows <= 0) {
        throw new TypeError('Google Search Console maxRows must be a positive safe integer')
    }

    const validate = (query: ResolvedMetricQuery): void => {
        for (const metric of query.metrics) {
            if (!['clicks', 'impressions', 'ctr', 'averagePosition'].includes(metric)) {
                throw new TypeError(`Unsupported Google Search Console metric: ${metric}`)
            }
        }
        for (const dimension of query.dimensions) {
            if (!(supportedDimensions as readonly string[]).includes(dimension)) {
                throw new TypeError(`Unsupported Google Search Console dimension: ${dimension}`)
            }
        }
        if (new Set(query.dimensions).size !== query.dimensions.length) {
            throw new TypeError('Google Search Console dimensions cannot be repeated')
        }
        if (query.dimensions.includes('hour') && dataState !== 'hourly_all') {
            throw new TypeError('The hour dimension requires dataState: hourly_all')
        }
        if (query.dimensions.includes('hour') && query.grain !== 'auto' && query.grain !== 'hour') {
            throw new TypeError('The hour dimension only supports hourly Search Console results')
        }
        if (
            query.dimensions.includes('date') &&
            !query.dimensions.includes('hour') &&
            query.grain !== 'auto' &&
            query.grain !== 'day'
        ) {
            throw new TypeError('The date dimension only supports daily Search Console results')
        }
        compileGoogleFilters(query.where)
    }

    const execute = async (
        query: ResolvedMetricQuery,
        signal?: AbortSignal,
    ): Promise<MetricAdapterOutput> => {
        validate(query)
        if (!options.auth.getAccessToken) {
            throw new InsightError(
                'CONFIGURATION_MISSING',
                'Google Search Console getAccessToken is missing',
            )
        }
        const accessToken = await options.auth.getAccessToken()
        if (accessToken.length === 0) {
            throw new TypeError('Google Search Console access token cannot be empty')
        }
        const request = (dimensions: readonly string[], requestedRows: number) =>
            searchAnalyticsRows({
                accessToken,
                dataState,
                dimensions,
                fetcher,
                maxRows,
                property: options.property,
                query,
                requestedRows,
                ...(signal ? { signal } : {}),
            })
        const [aggregate, rows] = await Promise.all([
            query.projection === 'rows' ? undefined : request([], 1),
            query.projection === 'aggregate'
                ? undefined
                : request(query.dimensions, query.limit ?? Number.POSITIVE_INFINITY),
        ])
        return googleReport(query, aggregate, rows)
    }

    return defineMetricAdapter({
        dimensions: {
            country: { operators: ['eq'], type: 'string' },
            date: { operators: [], type: 'date' },
            device: { operators: ['eq'], type: 'string' },
            hour: { operators: [], type: 'datetime' },
            page: { operators: ['eq', 'ne', 'contains'], type: 'string' },
            query: { operators: ['eq', 'ne', 'contains'], type: 'string' },
            searchAppearance: { operators: ['eq'], type: 'string' },
        },
        history: {
            grain: 'day',
            metrics: ['clicks', 'impressions', 'ctr'],
        },
        metrics: {
            averagePosition: {
                aggregation: { kind: 'mean' },
                rollup: 'non-additive',
                unit: '{position}',
            },
            clicks: { aggregation: { kind: 'sum' }, rollup: 'additive', unit: '{click}' },
            ctr: {
                aggregation: {
                    denominator: 'impressions',
                    kind: 'ratio',
                    numerator: 'clicks',
                },
                rollup: 'derived',
                unit: '1',
            },
            impressions: {
                aggregation: { kind: 'sum' },
                rollup: 'additive',
                unit: '{impression}',
            },
        },
        execute: (query, { signal }) =>
            execute(
                resolvedMetricQuery(
                    'google-search-console.searchAnalytics',
                    query,
                    query.grain === 'hour' ? 'hour' : 'date',
                ),
                signal,
            ),
    })
}

async function searchAnalyticsRows(options: {
    accessToken: string
    dataState: DataState
    dimensions: readonly string[]
    fetcher: Fetch
    maxRows: number
    property: string
    query: ResolvedMetricQuery
    requestedRows: number
    signal?: AbortSignal
}): Promise<SearchAnalyticsResult> {
    const { dimensions, query } = options
    const rows: NormalizedSearchAnalyticsRow[] = []
    const timeIndex = dimensions.findIndex((dimension) => ['date', 'hour'].includes(dimension))
    const timeDimension = dimensions[timeIndex]
    const timeCache = new Map<string, { iso: string; millis: number }>()
    const from = new Date(query.range.from).getTime()
    const to = new Date(query.range.to).getTime()
    const rowCount = Math.min(options.requestedRows, options.maxRows)
    let metadata: SearchAnalyticsMetadata | undefined
    let fetchedRows = 0
    let startRow = 0
    while (fetchedRows < rowCount) {
        const rowLimit = Math.min(PAGE_SIZE, rowCount - fetchedRows)
        // Pagination is sequential because each offset depends on the preceding page size.
        // eslint-disable-next-line no-await-in-loop
        const response = await fetchWithRetry(
            options.fetcher,
            `${SEARCH_ANALYTICS_ENDPOINT}/${encodeURIComponent(options.property)}/searchAnalytics/query`,
            {
                body: JSON.stringify({
                    dataState: options.dataState,
                    dimensions,
                    endDate: inclusiveCalendarEnd(query.range.to),
                    rowLimit,
                    startDate: calendarDate(query.range.from),
                    startRow,
                    ...compileGoogleFilters(query.where),
                }),
                headers: {
                    accept: 'application/json',
                    authorization: `Bearer ${options.accessToken}`,
                    'content-type': 'application/json',
                },
                method: 'POST',
                ...(options.signal ? { signal: options.signal } : {}),
            },
        )
        // eslint-disable-next-line no-await-in-loop
        const payload = await readJson(response)
        if (!response.ok) throw googleApiError(payload, response.status)
        const responseRows = record(payload)?.rows
        if (responseRows !== undefined && !Array.isArray(responseRows)) {
            throw new GoogleSearchConsoleApiError(
                'Google Search Console returned malformed rows',
                502,
            )
        }
        if (
            Array.isArray(responseRows) &&
            !responseRows.every((row) => isSearchAnalyticsRow(row, dimensions.length))
        ) {
            throw new GoogleSearchConsoleApiError(
                'Google Search Console returned malformed rows',
                502,
            )
        }
        const page = Array.isArray(responseRows) ? responseRows : []
        fetchedRows += page.length
        for (const row of page) {
            const keys = row.keys ?? []
            let time: { iso: string; millis: number } | undefined
            if (timeIndex !== -1) {
                const key = keys[timeIndex] ?? ''
                time = timeCache.get(key)
                if (time === undefined) {
                    const date =
                        timeDimension === 'date'
                            ? searchConsoleDayStart(key)
                            : Number.isFinite(new Date(key).getTime())
                              ? new Date(key)
                              : undefined
                    if (date === undefined) {
                        throw new GoogleSearchConsoleApiError(
                            'Google Search Console returned an invalid date dimension',
                            502,
                        )
                    }
                    time = { iso: date.toISOString(), millis: date.getTime() }
                    timeCache.set(key, time)
                }
                if (time.millis < from || time.millis >= to) continue
            }
            rows.push({
                clicks: row.clicks,
                ctr: row.ctr,
                impressions: row.impressions,
                keys,
                position: row.position,
                ...(time === undefined ? {} : { time: time.iso }),
            })
        }
        const responseMetadata = record(record(payload)?.metadata)
        if (responseMetadata !== undefined) metadata = responseMetadata
        if (page.length < rowLimit) break
        startRow += page.length
    }
    return {
        executionLimited:
            fetchedRows === options.maxRows && options.requestedRows > options.maxRows,
        ...(metadata ? { metadata } : {}),
        rows,
    }
}

function compileGoogleFilters(filter: CanonicalWhere | undefined): {
    dimensionFilterGroups?: unknown[]
} {
    if (filter === undefined) return {}
    const leaves = flattenAndFilter(filter)
    return {
        dimensionFilterGroups: [
            {
                filters: leaves.map((leaf) => {
                    if (!(supportedFilterDimensions as readonly string[]).includes(leaf.field)) {
                        throw new TypeError(
                            `Unsupported Google Search Console filter: ${leaf.field}`,
                        )
                    }
                    const operator = (
                        { contains: 'contains', eq: 'equals', ne: 'notEquals' } as Partial<
                            Record<typeof leaf.operator, string>
                        >
                    )[leaf.operator]
                    if (operator === undefined || typeof leaf.value !== 'string') {
                        throw new TypeError(
                            'Google Search Console filters support string eq, ne, and contains operators',
                        )
                    }
                    if (leaf.value.length > 4096) {
                        throw new TypeError(
                            'Google Search Console filter expressions cannot exceed 4096 characters',
                        )
                    }
                    if (leaf.field === 'country' && !/^[a-z]{3}$/i.test(leaf.value)) {
                        throw new TypeError(
                            'Google Search Console country filters require an ISO alpha-3 code',
                        )
                    }
                    if (
                        leaf.field === 'device' &&
                        !['DESKTOP', 'MOBILE', 'TABLET'].includes(leaf.value)
                    ) {
                        throw new TypeError(
                            'Google Search Console device filters require DESKTOP, MOBILE, or TABLET',
                        )
                    }
                    return { dimension: leaf.field, expression: leaf.value, operator }
                }),
                groupType: 'and',
            },
        ],
    }
}

function flattenAndFilter(filter: CanonicalWhere): Extract<CanonicalWhere, { field: string }>[] {
    if ('field' in filter) return [filter]
    if ('filters' in filter && filter.operator === 'and') {
        return filter.filters.flatMap(flattenAndFilter)
    }
    throw new TypeError('Google Search Console supports only AND filter groups')
}

function googleReport(
    query: ResolvedMetricQuery,
    aggregate: SearchAnalyticsResult | undefined,
    grouped: SearchAnalyticsResult | undefined,
): MetricAdapterOutput {
    const exactRange = canRepresentRangeExactly(query)
    const incompleteFrom = [aggregate?.metadata, grouped?.metadata]
        .flatMap((metadata) => [metadata?.first_incomplete_date, metadata?.first_incomplete_hour])
        .filter((value): value is string => typeof value === 'string')
        .toSorted()[0]
    const warnings = [
        ...(grouped
            ? [
                  {
                      code: 'google-search-console-top-rows',
                      message:
                          'Search Analytics returns top rows and does not guarantee every matching row',
                  },
              ]
            : []),
        ...(incompleteFrom === undefined
            ? []
            : [
                  {
                      code: 'google-search-console-incomplete-data',
                      message: `Search Console data is incomplete from ${incompleteFrom}`,
                  },
              ]),
        ...(query.timezone === SEARCH_CONSOLE_TIMEZONE
            ? []
            : [
                  {
                      code: 'google-search-console-timezone',
                      message:
                          'Search Console calendar dimensions use America/Los_Angeles regardless of the requested timezone',
                  },
              ]),
        ...(exactRange
            ? []
            : [
                  {
                      code: 'google-search-console-range-expanded',
                      message:
                          'Search Console exposes whole Pacific calendar days; the requested instant range was expanded to overlapping source days',
                  },
              ]),
        ...(grouped?.executionLimited
            ? [
                  {
                      code: 'execution-limit',
                      message:
                          'Search Console reached its execution limit; results may be incomplete',
                  },
              ]
            : []),
    ]
    const meta: Pick<MetricAdapterOutput, 'meta' | 'quality'> = {
        meta: {
            ...(incompleteFrom === undefined ? {} : { freshness: { incompleteFrom } }),
            temporal: {
                bucketTimezone: SEARCH_CONSOLE_TIMEZONE,
                ...(query.grain === 'auto' ? {} : { grain: query.grain }),
                sourceTimezone: SEARCH_CONSOLE_TIMEZONE,
            },
        },
        quality: {
            ...(exactRange ? {} : { approximate: true }),
            ...(grouped || incompleteFrom ? { partial: true } : {}),
            ...(warnings.length > 0 ? { warnings } : {}),
        },
    }

    const timeIndex = query.dimensions.findIndex((dimension) =>
        ['date', 'hour'].includes(dimension),
    )
    const dimensions = query.dimensions.flatMap((dimension, index) =>
        index === timeIndex ? [] : [[dimension, index] as const],
    )
    const points: MetricAdapterPoint[] = []
    for (const row of grouped?.rows ?? []) {
        points.push({
            ...(row.time === undefined ? {} : { time: row.time }),
            ...(dimensions.length === 0
                ? {}
                : {
                      dimensions: Object.fromEntries(
                          dimensions.map(([dimension, index]) => [
                              dimension,
                              row.keys[index] ?? null,
                          ]),
                      ),
                  }),
            values: googleMetricValues(query.metrics, row),
        })
    }
    return {
        ...meta,
        ...(aggregate ? { values: googleAggregateValues(query.metrics, aggregate.rows[0]) } : {}),
        ...(grouped ? { points } : {}),
    }
}

function googleAggregateValues(
    metrics: readonly string[],
    row: NormalizedSearchAnalyticsRow | undefined,
): MetricValues {
    const clicks = row?.clicks ?? 0
    const impressions = row?.impressions ?? 0
    return Object.fromEntries(
        metrics.map((metric) => {
            if (metric === 'clicks') return [metric, clicks]
            if (metric === 'impressions') return [metric, impressions]
            if (metric === 'ctr') return [metric, impressions === 0 ? null : clicks / impressions]
            return [metric, row?.position ?? null]
        }),
    )
}

function canRepresentRangeExactly(query: ResolvedMetricQuery): boolean {
    if (query.dimensions.includes('hour')) {
        return isSearchConsoleHour(query.range.from) && isSearchConsoleHour(query.range.to)
    }
    return isSearchConsoleMidnight(query.range.from) && isSearchConsoleMidnight(query.range.to)
}

function googleMetricValues(metrics: readonly string[], row: SearchAnalyticsRow): MetricValues {
    return Object.fromEntries(
        metrics.map((metric) => {
            if (metric === 'averagePosition') return [metric, number(row.position)]
            if (metric === 'clicks') return [metric, number(row.clicks)]
            if (metric === 'impressions') return [metric, number(row.impressions)]
            return [metric, number(row.ctr)]
        }),
    )
}

async function readJson(response: Response): Promise<unknown> {
    try {
        return await response.json()
    } catch (error) {
        throw new GoogleSearchConsoleApiError(
            `Google Search Console returned invalid JSON: ${String(error)}`,
            response.status,
        )
    }
}

function googleApiError(payload: unknown, status: number): GoogleSearchConsoleApiError {
    const error = record(record(payload)?.error)
    const nested = Array.isArray(error?.errors) ? record(error.errors[0]) : undefined
    const message =
        (typeof error?.message === 'string' ? error.message : undefined) ??
        `Google Search Console request failed (${status})`
    const code =
        typeof nested?.reason === 'string'
            ? nested.reason
            : typeof error?.code === 'string' || typeof error?.code === 'number'
              ? error.code
              : undefined
    return new GoogleSearchConsoleApiError(message, status, code)
}

function record(value: unknown): Record<string, unknown> | undefined {
    return isRecord(value) ? value : undefined
}

function isRecord(value: unknown): value is Record<string, unknown> {
    return typeof value === 'object' && value !== null && !Array.isArray(value)
}

function isSearchAnalyticsRow(value: unknown, dimensionCount: number): value is SearchAnalyticsRow {
    if (!isRecord(value)) return false
    if (![value.clicks, value.ctr, value.impressions, value.position].every(isFiniteNumber)) {
        return false
    }
    if (dimensionCount === 0) {
        return value.keys === undefined || (Array.isArray(value.keys) && value.keys.length === 0)
    }
    return (
        Array.isArray(value.keys) &&
        value.keys.length === dimensionCount &&
        value.keys.every((key) => typeof key === 'string')
    )
}

function isFiniteNumber(value: unknown): value is number {
    return typeof value === 'number' && Number.isFinite(value)
}

function calendarDate(value: string): string {
    const date = new Date(value)
    if (Number.isNaN(date.getTime())) throw new TypeError(`Invalid Search Console date: ${value}`)
    const parts = searchConsoleDateFormatter.formatToParts(date)
    const part = (type: Intl.DateTimeFormatPartTypes): string =>
        parts.find((candidate) => candidate.type === type)?.value ?? ''
    return `${part('year')}-${part('month')}-${part('day')}`
}

function inclusiveCalendarEnd(exclusiveEnd: string): string {
    const date = new Date(exclusiveEnd)
    if (Number.isNaN(date.getTime())) {
        throw new TypeError(`Invalid Search Console date: ${exclusiveEnd}`)
    }
    return calendarDate(new Date(date.getTime() - 1).toISOString())
}

function searchConsoleDayStart(value: string): Date | undefined {
    if (!/^\d{4}-\d{2}-\d{2}$/.test(value)) return undefined
    const desired = Date.parse(`${value}T00:00:00.000Z`)
    let instant = desired
    for (let iteration = 0; iteration < 3; iteration += 1) {
        const parts = searchConsoleDateTimeFormatter.formatToParts(new Date(instant))
        const part = (type: Intl.DateTimeFormatPartTypes): number =>
            Number(parts.find((candidate) => candidate.type === type)?.value ?? Number.NaN)
        const represented = Date.UTC(
            part('year'),
            part('month') - 1,
            part('day'),
            part('hour'),
            part('minute'),
            part('second'),
        )
        if (!Number.isFinite(represented)) return undefined
        const adjustment = desired - represented
        instant += adjustment
        if (adjustment === 0) return new Date(instant)
    }
    return undefined
}

function isSearchConsoleMidnight(value: string): boolean {
    const date = new Date(value)
    if (Number.isNaN(date.getTime())) return false
    const parts = searchConsoleTimeFormatter.formatToParts(date)
    const valueOf = (type: Intl.DateTimeFormatPartTypes): number =>
        Number(parts.find((part) => part.type === type)?.value ?? Number.NaN)
    return (
        valueOf('hour') === 0 &&
        valueOf('minute') === 0 &&
        valueOf('second') === 0 &&
        date.getUTCMilliseconds() === 0
    )
}

function isSearchConsoleHour(value: string): boolean {
    const date = new Date(value)
    if (Number.isNaN(date.getTime())) return false
    return (
        date.getUTCMinutes() === 0 && date.getUTCSeconds() === 0 && date.getUTCMilliseconds() === 0
    )
}

function number(value: unknown): number | null {
    if (typeof value === 'number' && Number.isFinite(value)) return value
    if (typeof value === 'string' && value.trim() !== '') {
        const parsed = Number(value)
        if (Number.isFinite(parsed)) return parsed
    }
    return null
}
