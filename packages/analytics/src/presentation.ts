import type {
    AnalyticsDimensionValues,
    AnalyticsGrain,
    AnalyticsMetricValues,
    AnalyticsReport,
    AnalyticsReportQuality,
    AnalyticsScalarReport,
    AnalyticsSeriesPoint,
    AnalyticsSeriesReport,
    AnalyticsTableReport,
} from './core/types'

export type AnalyticsTimezone = 'local' | (string & Record<never, never>)

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

export interface AnalyticsSeriesValue {
    index: number
    point: AnalyticsSeriesPoint
    time: number
    value: number | null
}

export interface AnalyticsChartSeries {
    color: string
    metric: string
    name: string
    values: readonly AnalyticsSeriesValue[]
}

export interface AnalyticsChartTooltipValue {
    color: string
    formatted: string
    metric: string
    name: string
    value: number | null
}

export interface AnalyticsChartTooltip {
    label: string
    point: AnalyticsSeriesPoint
    values: readonly AnalyticsChartTooltipValue[]
}

export interface AnalyticsYAxisDomain {
    max: number
    min: number
}

export interface AnalyticsSeriesPresentation {
    labels: readonly string[]
    metrics: readonly string[]
    series: readonly AnalyticsChartSeries[]
    timeDomain: readonly [number, number]
    times: readonly string[]
    timezone: AnalyticsTimezone
    yDomain: AnalyticsYAxisDomain
}

export interface AnalyticsSeriesPresentationOptions {
    colors?: readonly string[]
    locale?: string
    metrics?: readonly string[]
    timezone?: AnalyticsTimezone
    xAxis?: AnalyticsXAxisOptions
    yAxis?: AnalyticsYAxisOptions
}

export interface AnalyticsStatSelection {
    value: number | null
}

export const defaultChartColors = ['#6376dd', '#43a047', '#fb8c00', '#8e24aa', '#00838f', '#d81b60']

export function createAnalyticsSeriesPresentation(
    report: AnalyticsSeriesReport,
    options: AnalyticsSeriesPresentationOptions = {},
): AnalyticsSeriesPresentation {
    const locale = options.locale ?? 'en-US'
    const metrics = resolveSeriesMetrics(report, options.metrics)
    const colors = options.colors?.length ? options.colors : defaultChartColors
    const orderedPoints = report.points
        .map((point, index) => ({ index, point, time: new Date(point.time).valueOf() }))
        .filter(({ time }) => Number.isFinite(time))
        // oxlint-disable-next-line unicorn/no-array-sort -- the preceding map creates a private array
        .sort((left, right) => left.time - right.time || left.index - right.index)
    const series = metrics.map((metric, index): AnalyticsChartSeries => ({
        color: colors[index % colors.length]!,
        metric,
        name: formatMetricName(metric),
        values: orderedPoints.map(({ index: pointIndex, point, time }) => ({
            index: pointIndex,
            point,
            time,
            value: finiteMetric(point.values[metric]),
        })),
    }))

    return {
        labels: createAnalyticsTimeLabels(report, locale, options.timezone, options.xAxis),
        metrics,
        series,
        timeDomain: resolveTimeDomain(
            report,
            orderedPoints.map(({ time }) => time),
        ),
        times: report.points.map((point) => point.time),
        timezone: resolveAnalyticsTimezone(report, options.timezone),
        yDomain: resolveYAxisDomain(series, options.yAxis),
    }
}

export function selectStatValue(
    report: AnalyticsScalarReport,
    metric: string,
): AnalyticsStatSelection | undefined {
    return Object.hasOwn(report.values, metric)
        ? { value: finiteMetric(report.values[metric]) }
        : undefined
}

export function resolveSeriesMetrics(
    report: AnalyticsSeriesReport,
    requested: readonly string[] | undefined,
): string[] {
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
    report: AnalyticsTableReport,
    requested: readonly string[] | undefined,
    field: 'dimensions' | 'metrics',
): string[] {
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

    return report.points.map((_point, index) => {
        if (!indexes.has(index)) return ''
        return formatAnalyticsSeriesPointTime(report, index, locale, timezone, options)
    })
}

export function formatAnalyticsSeriesPointTime(
    report: AnalyticsSeriesReport,
    index: number,
    locale: string,
    timezone: AnalyticsTimezone | undefined,
    options: AnalyticsXAxisOptions = {},
): string {
    const point = report.points[index]
    if (!point) return ''
    const date = new Date(point.time)
    const context = createAnalyticsTimeFormatContext(report, index, locale, timezone)
    return options.formatter?.(date, context) ?? formatAnalyticsTime(date, context)
}

export function formatAnalyticsAxisTime(
    report: AnalyticsSeriesReport,
    time: number,
    locale: string,
    timezone: AnalyticsTimezone | undefined,
    options: AnalyticsXAxisOptions = {},
): string {
    const index = nearestPointIndex(report, time)
    const date = new Date(time)
    const context = createAnalyticsTimeFormatContext(report, index, locale, timezone)
    return options.formatter?.(date, context) ?? formatAnalyticsTime(date, context)
}

export function createAnalyticsChartTooltip(
    report: AnalyticsSeriesReport,
    series: readonly AnalyticsChartSeries[],
    index: number,
    locale: string,
    timezone: AnalyticsTimezone | undefined,
    xAxis: AnalyticsXAxisOptions = {},
    yAxis: AnalyticsYAxisOptions = {},
): AnalyticsChartTooltip | undefined {
    const point = report.points[index]
    if (!point) return undefined
    return {
        label: formatAnalyticsSeriesPointTime(report, index, locale, timezone, xAxis),
        point,
        values: series.map((item) => {
            const value = finiteMetric(point.values[item.metric])
            return {
                color: item.color,
                formatted:
                    value === null
                        ? 'No data'
                        : (yAxis.formatter?.(value) ?? formatMetricValue(value, locale)),
                metric: item.metric,
                name: item.name,
                value,
            }
        }),
    }
}

export function resolveYAxisDomain(
    series: readonly AnalyticsChartSeries[],
    options: AnalyticsYAxisOptions = {},
): AnalyticsYAxisDomain {
    const values = series.flatMap(({ values: seriesValues }) =>
        seriesValues.flatMap(({ value }) =>
            value === null || !Number.isFinite(value) ? [] : [value],
        ),
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

function resolveTimeDomain(
    report: AnalyticsSeriesReport,
    times: readonly number[],
): readonly [number, number] {
    if (times.length === 0) return [0, 1]
    const min = Math.min(...times)
    const max = Math.max(...times)
    if (min !== max) return [min, max]
    const spans: Partial<Record<AnalyticsGrain, number>> = {
        minute: 60_000,
        hour: 3_600_000,
        day: 86_400_000,
        month: 2_592_000_000,
        year: 31_536_000_000,
    }
    const span = spans[report.meta.temporal.grain ?? 'day'] ?? 86_400_000
    return [min - span / 2, max + span / 2]
}

function nearestPointIndex(report: AnalyticsSeriesReport, time: number): number {
    if (report.points.length === 0) return 0
    return report.points.reduce((nearest, point, index) => {
        const pointTime = new Date(point.time).valueOf()
        const nearestTime = new Date(report.points[nearest]!.time).valueOf()
        return Math.abs(pointTime - time) < Math.abs(nearestTime - time) ? index : nearest
    }, 0)
}

function unique(values: readonly string[]): string[] {
    return [...new Set(values)]
}
