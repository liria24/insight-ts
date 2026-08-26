import type {
    AnalyticsDimensionValues,
    AnalyticsMetricValues,
    AnalyticsReport,
    AnalyticsReportQuality,
    AnalyticsSeriesPoint,
} from './core/types'

export interface AnalyticsStatProps {
    emptyText?: string
    label?: string
    locale?: string
    maximumFractionDigits?: number
    metric: string
    report: AnalyticsReport
}

export interface AnalyticsLineChartProps {
    colors?: readonly string[]
    height?: number
    metrics?: readonly string[]
    report: AnalyticsReport
    smooth?: boolean
    title?: string
}

export interface AnalyticsBreakdownTableProps {
    dimensions?: readonly string[]
    emptyText?: string
    locale?: string
    maximumFractionDigits?: number
    metrics?: readonly string[]
    report: AnalyticsReport
}

export interface AnalyticsChartSeries {
    color?: string
    metric: string
    name: string
    values: readonly (number | null)[]
}

export interface AnalyticsStatSelection {
    point?: AnalyticsSeriesPoint
    value: number | null
}

export const defaultChartColors = ['#6376DD', '#43A047', '#FB8C00', '#8E24AA', '#00838F', '#D81B60']

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

export function formatMetricValue(value: number | null | undefined): string {
    const metric = finiteMetric(value)
    return metric === null ? 'No data' : formatNumber(metric, 'en-US', 2)
}

export function formatNumber(value: number, locale: string, maximumFractionDigits: number): string {
    return new Intl.NumberFormat(locale, { maximumFractionDigits }).format(value)
}

function unique(values: readonly string[]): string[] {
    return [...new Set(values)]
}
