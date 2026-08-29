import type { QueryResult } from 'insight-ts'
import type { Grain, MetricData, MetricMeta, TimeRange } from 'insight-ts/metrics'

export const demoRangeOptions = [
    { label: 'Last 24 Hours', value: '24h' },
    { label: 'Last 7 Days', value: '7d' },
    { label: 'Last Month', value: '1m' },
    { label: 'Last 3 Months', value: '3m' },
    { label: 'Last 6 Months', value: '6m' },
    { label: 'Last Year', value: '1y' },
] as const

export type DemoRangePreset = (typeof demoRangeOptions)[number]['value']

export interface DemoReportQuery {
    grain: Exclude<Grain, 'auto' | 'minute'>
    range: TimeRange
}

export interface DemoReportResponse {
    analytics: {
        countries: DemoMetricResult<'pageViews', 'country'>
        devices: DemoMetricResult<'visits', 'device'>
        referrers: DemoMetricResult<'visits', 'referer'>
        searchPages: DemoMetricResult<'clicks' | 'impressions', 'page'>
        searchQueries: DemoMetricResult<'clicks' | 'impressions', 'query'>
        searchSeries: DemoMetricResult<'clicks' | 'impressions' | 'ctr'>
        searchSummary: DemoMetricResult<'clicks' | 'impressions' | 'ctr' | 'averagePosition'>
        topPages: DemoMetricResult<'pageViews', 'path'>
        trafficSeries: DemoMetricResult<'pageViews' | 'visits'>
        trafficSummary: DemoMetricResult<'pageViews' | 'visits'>
    }
    billing: QueryResult<DemoBillingData>
    execution: { queriedAt: string; sources: readonly string[] }
    funnel: QueryResult<DemoFunnelData>
    logs: QueryResult<DemoLogsData, DemoLogsMeta>
    observability: {
        series: DemoMetricResult<'requestRate' | 'errorRate' | 'latencyP95'>
        summary: DemoMetricResult<'requestRate' | 'errorRate' | 'latencyP95'>
    }
    online: number
    product: {
        revenue: DemoMetricResult<'mrr', 'plan'>
        series: DemoMetricResult<'signups' | 'activeTeams'>
        summary: DemoMetricResult<'signups' | 'activeTeams'>
    }
    trace: QueryResult<DemoTraceData>
}

export type DemoMetricResult<
    TMetric extends string,
    TDimension extends string = never,
> = QueryResult<MetricData<TMetric, TDimension>, MetricMeta>

export interface DemoFunnelData {
    steps: readonly { converted: number; name: string; rate: number }[]
}

export interface DemoLogsData {
    entries: readonly { level: 'error' | 'info' | 'warn'; message: string; timestamp: string }[]
}

export interface DemoLogsMeta {
    nextCursor?: string
}

export interface DemoTraceData {
    edges: readonly { from: string; to: string }[]
    spans: readonly { durationMs: number; id: string; name: string; parentId?: string }[]
    traceId: string
}

export interface DemoBillingData {
    currency: 'USD'
    invoices: readonly { amount: number; customer: string; status: 'open' | 'paid' }[]
    outstanding: number
    revenue: number
}

const presetMilliseconds: Record<DemoRangePreset, number> = {
    '24h': 24 * 60 * 60 * 1000,
    '7d': 7 * 24 * 60 * 60 * 1000,
    '1m': 30 * 24 * 60 * 60 * 1000,
    '3m': 90 * 24 * 60 * 60 * 1000,
    '6m': 180 * 24 * 60 * 60 * 1000,
    '1y': 365 * 24 * 60 * 60 * 1000,
}

export function resolveDemoReportQuery(
    input: { from?: unknown; range?: unknown; to?: unknown },
    now = new Date(),
): DemoReportQuery {
    const fromInput = text(input.from)
    const toInput = text(input.to)
    if (fromInput !== undefined || toInput !== undefined) {
        if (fromInput === undefined || toInput === undefined) {
            throw new TypeError('Custom ranges require both from and to')
        }
        const from = new Date(fromInput)
        const requestedTo = new Date(toInput)
        const to = requestedTo > now ? now : requestedTo
        const duration = to.valueOf() - from.valueOf()
        if (
            !Number.isFinite(from.valueOf()) ||
            !Number.isFinite(to.valueOf()) ||
            duration <= 0 ||
            duration > 366 * 24 * 60 * 60 * 1000
        ) {
            throw new TypeError('Custom ranges must be valid and no longer than one year')
        }
        return {
            grain:
                duration <= 2 * 24 * 60 * 60 * 1000
                    ? 'hour'
                    : duration <= 60 * 24 * 60 * 60 * 1000
                      ? 'day'
                      : duration <= 210 * 24 * 60 * 60 * 1000
                        ? 'week'
                        : 'month',
            range: { from: from.toISOString(), to: to.toISOString() },
        }
    }

    const preset = text(input.range) ?? '7d'
    if (!isDemoRangePreset(preset)) {
        throw new TypeError('Unsupported demo range')
    }
    const duration = presetMilliseconds[preset]
    return {
        grain:
            preset === '24h'
                ? 'hour'
                : preset === '3m' || preset === '6m'
                  ? 'week'
                  : preset === '1y'
                    ? 'month'
                    : 'day',
        range: {
            from: new Date(now.valueOf() - duration).toISOString(),
            to: now.toISOString(),
        },
    }
}

function isDemoRangePreset(value: string): value is DemoRangePreset {
    return Object.hasOwn(presetMilliseconds, value)
}

function text(value: unknown): string | undefined {
    return typeof value === 'string' && value.length > 0 ? value : undefined
}
