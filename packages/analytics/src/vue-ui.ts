import type {
    AnalyticsDimensionValues,
    AnalyticsGrain,
    AnalyticsMetricValues,
    AnalyticsReport,
    AnalyticsReportQuality,
    AnalyticsSeriesPoint,
    AnalyticsSeriesReport,
} from './core/types'

export type AnalyticsUIClass =
    | string
    | readonly AnalyticsUIClass[]
    | Readonly<Record<string, boolean | undefined>>

export type AnalyticsTimezone = 'local' | (string & Record<never, never>)

export interface AnalyticsStatUI {
    root?: AnalyticsUIClass
    label?: AnalyticsUIClass
    value?: AnalyticsUIClass
    caption?: AnalyticsUIClass
    quality?: AnalyticsUIClass
    empty?: AnalyticsUIClass
}

export interface AnalyticsLineChartUI {
    root?: AnalyticsUIClass
    header?: AnalyticsUIClass
    title?: AnalyticsUIClass
    chart?: AnalyticsUIClass
    legend?: AnalyticsUIClass
    legendItem?: AnalyticsUIClass
    legendIndicator?: AnalyticsUIClass
    tooltip?: AnalyticsUIClass
    tooltipLabel?: AnalyticsUIClass
    tooltipValue?: AnalyticsUIClass
    quality?: AnalyticsUIClass
    empty?: AnalyticsUIClass
}

export interface AnalyticsBreakdownTableUI {
    root?: AnalyticsUIClass
    base?: AnalyticsUIClass
    thead?: AnalyticsUIClass
    tbody?: AnalyticsUIClass
    tr?: AnalyticsUIClass
    th?: AnalyticsUIClass
    td?: AnalyticsUIClass
    quality?: AnalyticsUIClass
    empty?: AnalyticsUIClass
}

export interface AnalyticsTimeFormatContext {
    grain?: AnalyticsGrain
    index: number
    locale: string
    timezone: AnalyticsTimezone
}

export interface AnalyticsXAxisOptions {
    formatter?: (date: Date, context: AnalyticsTimeFormatContext) => string
    maxTicks?: number
}

export interface AnalyticsYAxisOptions {
    formatter?: (value: number) => string
    includeZero?: boolean
    max?: number
    min?: number
    padding?: number
}

export interface AnalyticsStatProps {
    class?: AnalyticsUIClass
    emptyText?: string
    label?: string
    locale?: string
    maximumFractionDigits?: number
    metric: string
    report: AnalyticsReport
    timezone?: AnalyticsTimezone
    ui?: AnalyticsStatUI
}

export interface AnalyticsLineChartProps {
    class?: AnalyticsUIClass
    colors?: readonly string[]
    height?: number
    locale?: string
    metrics?: readonly string[]
    report: AnalyticsReport
    smooth?: boolean
    timezone?: AnalyticsTimezone
    title?: string
    ui?: AnalyticsLineChartUI
    xAxis?: AnalyticsXAxisOptions
    yAxis?: AnalyticsYAxisOptions
}

export interface AnalyticsBreakdownTableProps {
    class?: AnalyticsUIClass
    dimensions?: readonly string[]
    emptyText?: string
    locale?: string
    maximumFractionDigits?: number
    metrics?: readonly string[]
    report: AnalyticsReport
    ui?: AnalyticsBreakdownTableUI
}

export interface AnalyticsChartSeries {
    color?: string
    metric: string
    name: string
    values: readonly (number | null)[]
}

export interface AnalyticsChartTooltipValue {
    color?: string
    formatted: string
    metric: string
    name: string
    value: number | null
}

export interface AnalyticsYAxisDomain {
    max: number
    min: number
}

export interface AnalyticsStatSelection {
    point?: AnalyticsSeriesPoint
    value: number | null
}

export const defaultChartColors = ['#6376DD', '#43A047', '#FB8C00', '#8E24AA', '#00838F', '#D81B60']

export function resolveAnalyticsUIClass(base: string, custom?: AnalyticsUIClass): AnalyticsUIClass {
    return custom === undefined ? base : [base, custom]
}

export function selectStatValue(
    report: AnalyticsReport,
    metric: string,
): AnalyticsStatSelection | undefined {
    if (report.kind === 'scalar') {
        return Object.hasOwn(report.values, metric)
            ? { value: finiteMetric(report.values[metric]) }
            : undefined
    }
    if (report.kind !== 'series') return undefined
    const point = [...report.points]
        .filter((candidate) => Object.hasOwn(candidate.values, metric))
        .reduce<AnalyticsSeriesPoint | undefined>(
            (latest, candidate) => (!latest || candidate.time > latest.time ? candidate : latest),
            undefined,
        )
    return point ? { point, value: finiteMetric(point.values[metric]) } : undefined
}

export function resolveSeriesMetrics(
    report: AnalyticsReport,
    requested: readonly string[] | undefined,
): string[] {
    if (report.kind !== 'series') return []
    const available = new Set(
        report.points.flatMap((point) =>
            Object.entries(point.values).flatMap(([metric, value]) =>
                finiteMetric(value) === null ? [] : [metric],
            ),
        ),
    )
    return unique(requested?.length ? requested : [...available]).filter((metric) =>
        available.has(metric),
    )
}

export function resolveTableFields(
    report: AnalyticsReport,
    requested: readonly string[] | undefined,
    field: 'dimensions' | 'metrics',
): string[] {
    if (report.kind !== 'table') return []
    const available = new Set(report.rows.flatMap((row) => Object.keys(row[field])))
    return unique(requested?.length ? requested : [...available]).filter((name) =>
        available.has(name),
    )
}

export function resolveAnalyticsTimezone(
    report: AnalyticsReport,
    timezone?: AnalyticsTimezone,
): AnalyticsTimezone {
    return (
        timezone ??
        report.meta.temporal.bucketTimezone ??
        report.meta.temporal.sourceTimezone ??
        'UTC'
    )
}

export function createAnalyticsTimeFormatContext(
    report: AnalyticsReport,
    index: number,
    locale = 'en-US',
    timezone?: AnalyticsTimezone,
): AnalyticsTimeFormatContext {
    const grain = report.meta.temporal.grain
    return {
        ...(grain ? { grain } : {}),
        index,
        locale,
        timezone: resolveAnalyticsTimezone(report, timezone),
    }
}

export function formatAnalyticsTime(date: Date, context: AnalyticsTimeFormatContext): string {
    const timeZone = context.timezone === 'local' ? undefined : context.timezone
    const options: Intl.DateTimeFormatOptions =
        context.grain === 'minute' || context.grain === 'hour'
            ? { hour: '2-digit', hourCycle: 'h23', minute: '2-digit' }
            : context.grain === 'month'
              ? { month: 'short', year: 'numeric' }
              : context.grain === 'year'
                ? { year: 'numeric' }
                : { day: 'numeric', month: 'short' }
    return new Intl.DateTimeFormat(context.locale, { ...options, timeZone }).format(date)
}

export function createAnalyticsTimeLabels(
    report: AnalyticsSeriesReport,
    locale: string,
    timezone: AnalyticsTimezone | undefined,
    options: AnalyticsXAxisOptions = {},
): string[] {
    const count = report.points.length
    const maxTicks = Math.max(1, Math.floor(options.maxTicks ?? 6))
    const indexes = new Set<number>()
    if (count <= maxTicks) {
        for (let index = 0; index < count; index += 1) indexes.add(index)
    } else if (maxTicks === 1) {
        indexes.add(count - 1)
    } else {
        for (let tick = 0; tick < maxTicks; tick += 1) {
            indexes.add(Math.round((tick * (count - 1)) / (maxTicks - 1)))
        }
    }

    return report.points.map((point, index) => {
        if (!indexes.has(index)) return ''
        const date = new Date(point.time)
        const context = createAnalyticsTimeFormatContext(report, index, locale, timezone)
        return options.formatter?.(date, context) ?? formatAnalyticsTime(date, context)
    })
}

export function resolveYAxisDomain(
    series: readonly AnalyticsChartSeries[],
    options: AnalyticsYAxisOptions = {},
): AnalyticsYAxisDomain {
    const values = series.flatMap(({ values: seriesValues }) =>
        seriesValues.flatMap((value) => (value === null || !Number.isFinite(value) ? [] : [value])),
    )
    if (values.length === 0) return { min: options.min ?? 0, max: options.max ?? 1 }

    const sourceMin = Math.min(...values)
    const sourceMax = Math.max(...values)
    const nonNegative = sourceMin >= 0
    let min = options.includeZero ? Math.min(sourceMin, 0) : sourceMin
    let max = options.includeZero ? Math.max(sourceMax, 0) : sourceMax
    const padding = Math.max(options.padding ?? 0.05, 0)

    if (min === max) {
        const minimumSpan = Math.max(Math.abs(min) * 0.05, 1)
        min -= minimumSpan
        max += minimumSpan
    } else {
        const span = (max - min) * padding
        min -= span
        max += span
    }
    if (nonNegative && min < 0) min = 0

    min = options.min ?? min
    max = options.max ?? max
    if (min === max) {
        const minimumSpan = Math.max(Math.abs(min) * 0.05, 1)
        if (options.min === undefined)
            min = nonNegative ? Math.max(0, min - minimumSpan) : min - minimumSpan
        if (options.max === undefined || min === max) max += minimumSpan
    }
    return { min, max }
}

export function tableCellValue(
    column: string,
    values: AnalyticsDimensionValues | AnalyticsMetricValues,
): boolean | number | string | null {
    return values[column] ?? null
}

export function formatTableCell(
    value: boolean | number | string | null,
    locale: string,
    maximumFractionDigits: number,
): string {
    if (typeof value === 'number' && Number.isFinite(value)) {
        return formatNumber(value, locale, maximumFractionDigits)
    }
    return value === null ? '\u2014' : String(value)
}

export function qualityMessages(quality: AnalyticsReportQuality): string[] {
    return [
        ...(quality.partial ? ['Partial data'] : []),
        ...(quality.approximate ? ['Approximate data'] : []),
        ...(quality.sampled ? ['Sampled data'] : []),
        ...(quality.thresholded ? ['Thresholded data'] : []),
        ...(quality.warnings ?? []).map((warning) => warning.message),
    ]
}

export function finiteMetric(value: number | null | undefined): number | null {
    return typeof value === 'number' && Number.isFinite(value) ? value : null
}

export function formatMetricName(metric: string): string {
    return metric
        .replace(/([a-z\d])([A-Z])/g, '$1 $2')
        .replace(/[_-]+/g, ' ')
        .replace(/^./, (character) => character.toUpperCase())
}

export function formatMetricValue(value: number | null | undefined, locale = 'en-US'): string {
    const metric = finiteMetric(value)
    return metric === null ? 'No data' : formatNumber(metric, locale, 2)
}

export function formatNumber(value: number, locale: string, maximumFractionDigits: number): string {
    return new Intl.NumberFormat(locale, { maximumFractionDigits }).format(value)
}

function unique(values: readonly string[]): string[] {
    return [...new Set(values)]
}
