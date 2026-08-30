import type { QueryQuality, QueryResult } from '../core/types.ts'
import type {
    DimensionValue,
    HistoryFidelityBand,
    MetricData,
    MetricMeta,
} from '../metrics/index.ts'

export type MetricQueryResult<
    TMetric extends string = string,
    TDimension extends string = string,
> = QueryResult<MetricData<TMetric, TDimension>, MetricMeta>

export type Timezone = 'local' | 'source' | 'utc' | (string & {})

export interface XAxisOptions {
    formatter?: (value: Date) => string
    maxTicks?: number
}

export interface YAxisOptions {
    domain?: { max?: number; min?: number }
    formatter?: (value: number) => string
}

export interface YAxisDomain {
    max: number
    min: number
}

export interface SeriesValue {
    index: number
    time: number
    value: number
}

export interface ChartSeries {
    color: string
    metric: string
    name: string
    values: readonly SeriesValue[]
}

export interface MetricSeriesPoint {
    dimensions?: Readonly<Record<string, DimensionValue | undefined>>
    time: string
    values: Readonly<Record<string, number | null>>
}

export interface MetricTableRow {
    dimensions: Readonly<Record<string, DimensionValue | undefined>>
    metrics: Readonly<Record<string, number | null>>
}

export interface ChartTooltipValue {
    color: string
    formatted: string
    metric: string
    name: string
    value: number | null
}

export interface ChartTooltipModel {
    label: string
    point: MetricSeriesPoint
    values: readonly ChartTooltipValue[]
}

export interface DataNotice {
    code: string
    message: string
}

export interface SeriesModel {
    fidelityBands: readonly (HistoryFidelityBand & { from: number; to: number })[]
    points: readonly MetricSeriesPoint[]
    series: readonly ChartSeries[]
    timeDomain: readonly [number, number]
    yDomain: YAxisDomain
}

export interface BreakdownModel {
    dimensions: readonly string[]
    metrics: readonly string[]
    rows: readonly MetricTableRow[]
}

export const formatMetricName = (value: string): string =>
    value
        .replaceAll(/([a-z\d])([A-Z])/g, '$1 $2')
        .replaceAll(/[-_.]+/g, ' ')
        .replace(/^\w/, (character) => character.toUpperCase())

export const formatNumber = (value: number, locale = 'en-US', maximumFractionDigits = 2): string =>
    new Intl.NumberFormat(locale, { maximumFractionDigits }).format(value)

export const formatMetricValue = (value: number, locale = 'en-US'): string =>
    formatNumber(value, locale, 2)

export const formatTableCell = (
    value: DimensionValue,
    locale = 'en-US',
    maximumFractionDigits = 2,
): string => {
    if (value === null) return '—'
    return typeof value === 'number'
        ? formatNumber(value, locale, maximumFractionDigits)
        : String(value)
}

export const tableCellValue = (
    column: string,
    values: Readonly<Record<string, DimensionValue | undefined>>,
): DimensionValue => values[column] ?? null

export const createStatModel = (
    result: MetricQueryResult,
): { metric: string; value: number | null } | undefined => {
    const metric = Object.keys(result.data)[0]
    if (!metric) return undefined
    const datum = result.data[metric]
    return datum ? { metric, value: datum.value } : undefined
}

export const createDataNotices = (quality: QueryQuality | undefined): DataNotice[] => {
    if (!quality) return []
    return [
        ...(quality.approximate
            ? [{ code: 'approximate', message: 'Results are approximate' }]
            : []),
        ...(quality.partial ? [{ code: 'partial', message: 'Results are partial' }] : []),
        ...(quality.sampled
            ? [
                  {
                      code: 'sampled',
                      message:
                          quality.sampleRate === undefined
                              ? 'Results are sampled'
                              : `Results use ${formatNumber(quality.sampleRate * 100)}% sampling`,
                  },
              ]
            : []),
        ...(quality.thresholded
            ? [{ code: 'thresholded', message: 'Results are thresholded' }]
            : []),
        ...(quality.warnings ?? []),
    ]
}

export const formatDataNotice = (notice: DataNotice): string => notice.message

export const createSeriesModel = (
    result: MetricQueryResult,
    options: {
        colors: readonly string[]
        locale?: string
        timezone?: Timezone
        xAxis?: XAxisOptions
        yAxis?: YAxisOptions
    },
): SeriesModel => {
    const metrics = Object.keys(result.data)
    const points = seriesPoints(result.data)
    const series = metrics.map((metric, index) => ({
        color: options.colors[index % options.colors.length] ?? 'currentColor',
        metric,
        name: formatMetricName(metric),
        values: points.flatMap((point, pointIndex) => {
            const value = point.values[metric]
            return value === null || value === undefined
                ? []
                : [{ index: pointIndex, time: new Date(point.time).valueOf(), value }]
        }),
    }))
    const times = points.map(({ time }) => new Date(time).valueOf()).filter(Number.isFinite)
    const values = series.flatMap(({ values: items }) => items.map(({ value }) => value))
    const minimumTime = times.length === 0 ? 0 : Math.min(...times)
    const maximumTime = times.length === 0 ? 1 : Math.max(...times)
    const timeDomain: [number, number] =
        minimumTime === maximumTime ? [minimumTime, minimumTime + 1] : [minimumTime, maximumTime]
    const automatic = domain(values)
    return {
        fidelityBands: (result.meta.fidelity ?? []).map((band) => ({
            ...band,
            from: new Date(band.range.from).valueOf(),
            to: new Date(band.range.to).valueOf(),
        })),
        points,
        series,
        timeDomain,
        yDomain: {
            min: options.yAxis?.domain?.min ?? automatic.min,
            max: options.yAxis?.domain?.max ?? automatic.max,
        },
    }
}

export const createBreakdownModel = (result: MetricQueryResult): BreakdownModel => {
    const metrics = Object.keys(result.data)
    const rows = breakdownRows(result.data, metrics)
    const dimensions = [...new Set(rows.flatMap(({ dimensions: values }) => Object.keys(values)))]
    return { dimensions, metrics, rows }
}

export const createChartTooltipModel = (
    result: MetricQueryResult,
    series: readonly ChartSeries[],
    index: number,
    locale = 'en-US',
    timezone?: Timezone,
    xAxis?: XAxisOptions,
    yAxis?: YAxisOptions,
): ChartTooltipModel | undefined => {
    const point = seriesPoints(result.data)[index]
    if (!point) return undefined
    return {
        label: formatTime(point.time, locale, timezone, xAxis),
        point,
        values: series.map((item) => {
            const value = point.values[item.metric] ?? null
            return {
                color: item.color,
                formatted:
                    value === null
                        ? 'No data'
                        : (yAxis?.formatter?.(value) ?? formatMetricValue(value, locale)),
                metric: item.metric,
                name: item.name,
                value,
            }
        }),
    }
}

export const formatAxisTime = (
    _result: MetricQueryResult,
    value: number,
    locale = 'en-US',
    timezone?: Timezone,
    options?: XAxisOptions,
): string => formatTime(new Date(value).toISOString(), locale, timezone, options)

export const formatSeriesPointTime = (
    result: MetricQueryResult,
    index: number,
    locale = 'en-US',
    timezone?: Timezone,
    options?: XAxisOptions,
): string => {
    const point = seriesPoints(result.data)[index]
    return point ? formatTime(point.time, locale, timezone, options) : ''
}

export const seriesPoints = (data: MetricData): MetricSeriesPoint[] => {
    const byKey = new Map<string, MetricSeriesPoint>()
    for (const [metric, datum] of Object.entries(data)) {
        for (const point of datum.points ?? []) {
            if (!point.time) continue
            const key = JSON.stringify([point.time, point.dimensions ?? {}])
            const current = byKey.get(key) ?? {
                ...(point.dimensions ? { dimensions: point.dimensions } : {}),
                time: point.time,
                values: {},
            }
            byKey.set(key, {
                ...current,
                values: { ...current.values, [metric]: point.value },
            })
        }
    }
    return [...byKey.values()].toSorted((left, right) => left.time.localeCompare(right.time))
}

const breakdownRows = (data: MetricData, metrics: readonly string[]): MetricTableRow[] => {
    const rows = new Map<string, MetricTableRow>()
    for (const metric of metrics) {
        for (const point of data[metric]?.points ?? []) {
            if (!point.dimensions) continue
            const key = JSON.stringify(point.dimensions)
            const current = rows.get(key) ?? { dimensions: point.dimensions, metrics: {} }
            rows.set(key, {
                ...current,
                metrics: { ...current.metrics, [metric]: point.value },
            })
        }
    }
    return [...rows.values()]
}

const formatTime = (
    value: string,
    locale: string,
    timezone?: Timezone,
    options?: XAxisOptions,
): string => {
    const date = new Date(value)
    if (options?.formatter) return options.formatter(date)
    return new Intl.DateTimeFormat(locale, {
        dateStyle: 'medium',
        timeStyle: 'short',
        ...(timezone === 'utc'
            ? { timeZone: 'UTC' }
            : timezone && timezone !== 'local' && timezone !== 'source'
              ? { timeZone: timezone }
              : {}),
    }).format(date)
}

const domain = (values: readonly number[]): YAxisDomain => {
    if (values.length === 0) return { max: 1, min: 0 }
    let min = Math.min(...values)
    let max = Math.max(...values)
    if (min === max) {
        const padding = Math.abs(min) * 0.1 || 1
        min -= padding
        max += padding
    }
    return { max, min }
}

export type TimeFormatContext = {
    locale: string
    timezone?: Timezone
}
