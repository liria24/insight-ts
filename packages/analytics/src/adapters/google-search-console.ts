import type {
    AnalyticsAdapter,
    AnalyticsFilter,
    AnalyticsMetricValues,
    AnalyticsReport,
    AnalyticsReportMeta,
    ResolvedAnalyticsQuery,
} from '../core/types.ts'

const SEARCH_ANALYTICS_ENDPOINT = 'https://www.googleapis.com/webmasters/v3/sites'
const PAGE_SIZE = 25_000
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

export class GoogleSearchConsoleApiError extends Error {
    readonly code: string | number | undefined
    readonly status: number

    constructor(message: string, status: number, code?: string | number) {
        super(message)
        this.name = 'GoogleSearchConsoleApiError'
        this.status = status
        this.code = code
    }
}

export interface GoogleSearchConsoleOptions {
    auth: {
        getAccessToken(): Promise<string>
    }
    dataState?: DataState
    datasetId?: string
    fetch?: Fetch
    property: string
}

interface SearchAnalyticsRow {
    clicks?: unknown
    ctr?: unknown
    impressions?: unknown
    keys?: unknown
    position?: unknown
}

interface SearchAnalyticsMetadata {
    first_incomplete_date?: unknown
    first_incomplete_hour?: unknown
}

export function googleSearchConsole(options: GoogleSearchConsoleOptions): AnalyticsAdapter {
    const fetcher = options.fetch ?? globalThis.fetch
    const dataState = options.dataState ?? 'final'
    const datasetId = options.datasetId ?? 'google-search-console.search-analytics'

    const validate = (query: ResolvedAnalyticsQuery): void => {
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
        compileGoogleFilters(query.filters)
    }

    return {
        dataset: {
            archive: [
                {
                    dimensions: ['date'],
                    grain: 'day',
                    id: 'daily-search',
                    metrics: ['clicks', 'impressions', 'ctr'],
                },
            ],
            dimensions: supportedDimensions.map((id) => ({
                id,
                valueType:
                    id === 'date'
                        ? ('date' as const)
                        : id === 'hour'
                          ? ('datetime' as const)
                          : ('string' as const),
            })),
            domain: 'search',
            id: datasetId,
            metrics: [
                { aggregation: 'sum', id: 'clicks', rollup: 'additive', valueType: 'integer' },
                { aggregation: 'sum', id: 'impressions', rollup: 'additive', valueType: 'integer' },
                {
                    aggregation: 'ratio',
                    derive: { denominator: 'impressions', numerator: 'clicks', operation: 'ratio' },
                    id: 'ctr',
                    rollup: 'derived',
                    valueType: 'ratio',
                },
                {
                    aggregation: 'mean',
                    id: 'averagePosition',
                    rollup: 'non-additive',
                    valueType: 'position',
                },
            ],
        },
        async query(query: ResolvedAnalyticsQuery): Promise<AnalyticsReport> {
            validate(query)
            const accessToken = await options.auth.getAccessToken()
            if (accessToken.length === 0) {
                throw new TypeError('Google Search Console access token cannot be empty')
            }

            const rows: SearchAnalyticsRow[] = []
            let metadata: SearchAnalyticsMetadata | undefined
            let startRow = 0
            while (true) {
                const remaining = query.limit === undefined ? PAGE_SIZE : query.limit - rows.length
                if (remaining <= 0) break
                const rowLimit = Math.min(PAGE_SIZE, remaining)
                const body = {
                    dataState,
                    dimensions: query.dimensions,
                    endDate: inclusiveCalendarEnd(query.range.to),
                    rowLimit,
                    startDate: calendarDate(query.range.from),
                    startRow,
                    ...compileGoogleFilters(query.filters),
                }
                // Pagination is sequential because the next offset depends on this page's row count.
                // eslint-disable-next-line no-await-in-loop
                const response = await fetcher(
                    `${SEARCH_ANALYTICS_ENDPOINT}/${encodeURIComponent(options.property)}/searchAnalytics/query`,
                    {
                        body: JSON.stringify(body),
                        headers: {
                            accept: 'application/json',
                            authorization: `Bearer ${accessToken}`,
                            'content-type': 'application/json',
                        },
                        method: 'POST',
                    },
                )
                // eslint-disable-next-line no-await-in-loop
                const payload = await readJson(response)
                if (!response.ok) {
                    throw googleApiError(payload, response.status)
                }
                const responseRows = record(payload)?.rows
                if (responseRows !== undefined && !Array.isArray(responseRows)) {
                    throw new GoogleSearchConsoleApiError(
                        'Google Search Console returned malformed rows',
                        502,
                    )
                }
                if (
                    Array.isArray(responseRows) &&
                    !responseRows.every((row) => isSearchAnalyticsRow(row, query.dimensions.length))
                ) {
                    throw new GoogleSearchConsoleApiError(
                        'Google Search Console returned malformed rows',
                        502,
                    )
                }
                const page = Array.isArray(responseRows) ? responseRows : []
                rows.push(...page)
                const responseMetadata = record(record(payload)?.metadata)
                if (responseMetadata !== undefined) metadata = responseMetadata
                if (page.length < rowLimit) break
                startRow += page.length
            }

            return googleReport(query, rows, metadata)
        },
        validate,
    }
}

function compileGoogleFilters(filter: AnalyticsFilter | undefined): {
    dimensionFilterGroups?: unknown[]
} {
    if (filter === undefined) return {}
    const leaves = flattenAndFilter(filter)
    return {
        dimensionFilterGroups: [
            {
                filters: leaves.map((leaf) => {
                    if (
                        !(supportedFilterDimensions as readonly string[]).includes(leaf.dimension)
                    ) {
                        throw new TypeError(
                            `Unsupported Google Search Console filter: ${leaf.dimension}`,
                        )
                    }
                    const operator = (
                        { contains: 'contains', eq: 'equals', neq: 'notEquals' } as Partial<
                            Record<typeof leaf.operator, string>
                        >
                    )[leaf.operator]
                    if (operator === undefined || typeof leaf.value !== 'string') {
                        throw new TypeError(
                            'Google Search Console filters support string eq, neq, and contains operators',
                        )
                    }
                    if (leaf.value.length > 4096) {
                        throw new TypeError(
                            'Google Search Console filter expressions cannot exceed 4096 characters',
                        )
                    }
                    if (leaf.dimension === 'country' && !/^[a-z]{3}$/i.test(leaf.value)) {
                        throw new TypeError(
                            'Google Search Console country filters require an ISO alpha-3 code',
                        )
                    }
                    if (
                        leaf.dimension === 'device' &&
                        !['DESKTOP', 'MOBILE', 'TABLET'].includes(leaf.value)
                    ) {
                        throw new TypeError(
                            'Google Search Console device filters require DESKTOP, MOBILE, or TABLET',
                        )
                    }
                    return { dimension: leaf.dimension, expression: leaf.value, operator }
                }),
                groupType: 'and',
            },
        ],
    }
}

function flattenAndFilter(
    filter: AnalyticsFilter,
): Extract<AnalyticsFilter, { dimension: string }>[] {
    if ('dimension' in filter) return [filter]
    if ('and' in filter) return filter.and.flatMap(flattenAndFilter)
    throw new TypeError('Google Search Console supports only AND filter groups')
}

function googleReport(
    query: ResolvedAnalyticsQuery,
    rows: SearchAnalyticsRow[],
    metadata: SearchAnalyticsMetadata | undefined,
): AnalyticsReport {
    const normalizedRows = trimRowsToRange(query, rows)
    const exactRange = canRepresentRangeExactly(query)
    const incompleteFrom =
        typeof metadata?.first_incomplete_date === 'string'
            ? metadata.first_incomplete_date
            : typeof metadata?.first_incomplete_hour === 'string'
              ? metadata.first_incomplete_hour
              : undefined
    const warnings = [
        {
            code: 'google-search-console-top-rows',
            message: 'Search Analytics returns top rows and does not guarantee every matching row',
        },
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
    ]
    const meta: AnalyticsReportMeta = {
        ...(incompleteFrom === undefined ? {} : { freshness: { incompleteFrom } }),
        quality: { ...(exactRange ? {} : { approximate: true }), partial: true, warnings },
        queriedAt: new Date().toISOString(),
        source: query.source,
        temporal: {
            bucketTimezone: SEARCH_CONSOLE_TIMEZONE,
            grain: query.grain,
            sourceTimezone: SEARCH_CONSOLE_TIMEZONE,
        },
    }

    if (query.dimensions.length === 0) {
        return {
            kind: 'scalar',
            meta,
            values: aggregateGoogleMetrics(query.metrics, normalizedRows),
        }
    }
    if (query.dimensions.length === 1 && ['date', 'hour'].includes(query.dimensions[0] ?? '')) {
        const dimension = query.dimensions[0]
        return {
            kind: 'series',
            meta,
            points: normalizedRows.map((row) => ({
                time:
                    dimension === 'date'
                        ? (searchConsoleDayStart(rowKeys(row)[0] ?? '')?.toISOString() ?? '')
                        : new Date(rowKeys(row)[0] ?? '').toISOString(),
                values: googleMetricValues(query.metrics, row),
            })),
        }
    }
    return {
        kind: 'table',
        meta,
        rows: normalizedRows.map((row) => ({
            dimensions: Object.fromEntries(
                query.dimensions.map((dimension, index) => [
                    dimension,
                    rowKeys(row)[index] ?? null,
                ]),
            ),
            metrics: googleMetricValues(query.metrics, row),
        })),
    }
}

function trimRowsToRange(
    query: ResolvedAnalyticsQuery,
    rows: SearchAnalyticsRow[],
): SearchAnalyticsRow[] {
    const hourIndex = query.dimensions.indexOf('hour')
    const dateIndex = query.dimensions.indexOf('date')
    if (dateIndex === -1 && hourIndex === -1) return rows
    const from = new Date(query.range.from).getTime()
    const to = new Date(query.range.to).getTime()
    return rows.filter((row) => {
        const key = rowKeys(row)[hourIndex === -1 ? dateIndex : hourIndex] ?? ''
        const start =
            hourIndex === -1
                ? searchConsoleDayStart(key)
                : Number.isFinite(new Date(key).getTime())
                  ? new Date(key)
                  : undefined
        if (!start) {
            throw new GoogleSearchConsoleApiError(
                'Google Search Console returned an invalid date dimension',
                502,
            )
        }
        return start.getTime() >= from && start.getTime() < to
    })
}

function canRepresentRangeExactly(query: ResolvedAnalyticsQuery): boolean {
    if (query.dimensions.includes('hour')) {
        return isSearchConsoleHour(query.range.from) && isSearchConsoleHour(query.range.to)
    }
    return isSearchConsoleMidnight(query.range.from) && isSearchConsoleMidnight(query.range.to)
}

function googleMetricValues(
    metrics: readonly string[],
    row: SearchAnalyticsRow,
): AnalyticsMetricValues {
    return Object.fromEntries(
        metrics.map((metric) => {
            if (metric === 'averagePosition') return [metric, number(row.position)]
            if (metric === 'clicks') return [metric, number(row.clicks)]
            if (metric === 'impressions') return [metric, number(row.impressions)]
            return [metric, number(row.ctr)]
        }),
    )
}

function aggregateGoogleMetrics(
    metrics: readonly string[],
    rows: SearchAnalyticsRow[],
): AnalyticsMetricValues {
    const clicks = rows.reduce((total, row) => total + (number(row.clicks) ?? 0), 0)
    const impressions = rows.reduce((total, row) => total + (number(row.impressions) ?? 0), 0)
    const weightedPosition = rows.reduce(
        (total, row) => total + (number(row.position) ?? 0) * (number(row.impressions) ?? 0),
        0,
    )
    return Object.fromEntries(
        metrics.map((metric) => {
            if (metric === 'clicks') return [metric, clicks]
            if (metric === 'impressions') return [metric, impressions]
            if (metric === 'ctr') return [metric, impressions === 0 ? null : clicks / impressions]
            return [metric, impressions === 0 ? null : weightedPosition / impressions]
        }),
    )
}

function rowKeys(row: SearchAnalyticsRow): string[] {
    return Array.isArray(row.keys)
        ? row.keys.map((key) => (typeof key === 'string' ? key : String(key)))
        : []
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
