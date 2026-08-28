import type {
    AnalyticsGrain,
    AnalyticsRange,
    AnalyticsScalarReport,
    AnalyticsSeriesReport,
} from '@liria24/analytics'

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
    grain: Exclude<AnalyticsGrain, 'auto' | 'minute'>
    range: AnalyticsRange
}

export interface DemoReportResponse {
    online: number
    series: AnalyticsSeriesReport
    summary: AnalyticsScalarReport
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
