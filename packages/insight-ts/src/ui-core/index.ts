import type { QueryQuality, QueryResult } from '../core/types.ts'
import type { DimensionValue, MetricData, MetricMeta, MetricPoint } from '../metrics/index.ts'

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

export type MetricSeriesPoint = MetricPoint & {
    key: string
    time: string
    timestamp: number
}

export interface MetricTableRow {
    dimensions: Readonly<Record<string, DimensionValue | undefined>>
    key: string
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

const numberFormatters = new Map<string, Intl.NumberFormat>()
const timeFormatters = new Map<string, Intl.DateTimeFormat>()

export const formatMetricName = (value: string): string =>
    value
        .replaceAll(/([a-z\d])([A-Z])/g, '$1 $2')
        .replaceAll(/[-_.]+/g, ' ')
        .replace(/^\w/, (character) => character.toUpperCase())

export const formatNumber = (
    value: number,
    locale = 'en-US',
    maximumFractionDigits = 2,
): string => {
    const key = `${locale}\0${maximumFractionDigits}`
    let formatter = numberFormatters.get(key)
    if (!formatter) {
        formatter = new Intl.NumberFormat(locale, { maximumFractionDigits })
        numberFormatters.set(key, formatter)
    }
    return formatter.format(value)
}

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
    const metric = Object.keys(result.aggregate ?? {})[0]
    if (!metric) return undefined
    return { metric, value: result.aggregate[metric] ?? null }
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
        includeZero?: boolean
        locale?: string
        maxPoints?: number
        timezone?: Timezone
        xAxis?: XAxisOptions
        yAxis?: YAxisOptions
    },
): SeriesModel => {
    const metrics = metricNames(result)
    const points = seriesPoints(result)
    const indexes = sampledIndexes(points.length, options.maxPoints ?? points.length)
    const series = metrics.map((metric, seriesIndex) => {
        const values: SeriesValue[] = []
        for (const index of indexes) {
            const point = points[index]
            const value = point?.values[metric]
            if (point && value !== null && value !== undefined) {
                values.push({ index, time: point.timestamp, value })
            }
        }
        return {
            color: options.colors[seriesIndex % options.colors.length] ?? 'currentColor',
            metric,
            name: formatMetricName(metric),
            values,
        }
    })
    let minimumTime = Number.POSITIVE_INFINITY
    let maximumTime = Number.NEGATIVE_INFINITY
    let minimumValue = Number.POSITIVE_INFINITY
    let maximumValue = Number.NEGATIVE_INFINITY
    for (const point of points) {
        minimumTime = Math.min(minimumTime, point.timestamp)
        maximumTime = Math.max(maximumTime, point.timestamp)
        for (const metric of metrics) {
            const value = point.values[metric]
            if (value !== null && value !== undefined && Number.isFinite(value)) {
                minimumValue = Math.min(minimumValue, value)
                maximumValue = Math.max(maximumValue, value)
            }
        }
    }
    const timeDomain: [number, number] =
        minimumTime === Number.POSITIVE_INFINITY
            ? [0, 1]
            : minimumTime === maximumTime
              ? [minimumTime, minimumTime + 1]
              : [minimumTime, maximumTime]
    const automatic = domain(minimumValue, maximumValue)
    if (options.includeZero) {
        automatic.min = Math.min(0, automatic.min)
        automatic.max = Math.max(0, automatic.max)
    }
    return {
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
    const metrics = metricNames(result)
    const dimensions = new Set<string>()
    const rows: MetricTableRow[] = []
    for (const point of result.rows ?? []) {
        if (!point.dimensions) continue
        for (const dimension of Object.keys(point.dimensions)) dimensions.add(dimension)
        rows.push({
            dimensions: point.dimensions,
            key: rowKey(point),
            metrics: point.values,
        })
    }
    return { dimensions: [...dimensions], metrics, rows }
}

export const createChartTooltipModel = (
    model: SeriesModel,
    index: number,
    locale = 'en-US',
    timezone?: Timezone,
    xAxis?: XAxisOptions,
    yAxis?: YAxisOptions,
): ChartTooltipModel | undefined => {
    const point = model.points[index]
    if (!point) return undefined
    return {
        label: formatTime(point.timestamp, locale, timezone, xAxis),
        point,
        values: model.series.map((item) => {
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
    value: number,
    locale = 'en-US',
    timezone?: Timezone,
    options?: XAxisOptions,
): string => formatTime(value, locale, timezone, options)

export const formatSeriesPointTime = (
    point: MetricSeriesPoint,
    locale = 'en-US',
    timezone?: Timezone,
    options?: XAxisOptions,
): string => formatTime(point.timestamp, locale, timezone, options)

export const seriesPoints = (data: MetricData): MetricSeriesPoint[] => {
    const points: MetricSeriesPoint[] = []
    for (const point of data.rows ?? []) {
        if (point.time === undefined) continue
        const timestamp = Date.parse(point.time)
        if (!Number.isFinite(timestamp)) continue
        points.push({
            ...(point.dimensions ? { dimensions: point.dimensions } : {}),
            key: rowKey(point),
            time: point.time,
            timestamp,
            values: point.values,
        })
    }
    points.sort((left, right) => left.timestamp - right.timestamp)
    return points
}

const metricNames = (data: MetricData): string[] => {
    const aggregate = Object.keys(data.aggregate ?? {})
    return aggregate.length > 0 ? aggregate : Object.keys(data.rows?.[0]?.values ?? {})
}

const rowKey = (point: MetricPoint): string =>
    JSON.stringify([point.time ?? null, point.dimensions ?? null])

const sampledIndexes = (length: number, maximum: number): number[] => {
    const size = Math.max(1, Math.floor(maximum))
    if (length <= size) return Array.from({ length }, (_, index) => index)
    if (size === 1) return [0]
    // ponytail: even sampling can miss narrow peaks; use shape-aware decimation if charts need them.
    return Array.from({ length: size }, (_, index) =>
        Math.round((index * (length - 1)) / (size - 1)),
    )
}

const formatTime = (
    value: number,
    locale: string,
    timezone?: Timezone,
    options?: XAxisOptions,
): string => {
    const date = new Date(value)
    if (options?.formatter) return options.formatter(date)
    const timeZone =
        timezone === 'utc'
            ? 'UTC'
            : timezone && timezone !== 'local' && timezone !== 'source'
              ? timezone
              : undefined
    const key = `${locale}\0${timeZone ?? ''}`
    let formatter = timeFormatters.get(key)
    if (!formatter) {
        formatter = new Intl.DateTimeFormat(locale, {
            dateStyle: 'medium',
            timeStyle: 'short',
            ...(timeZone ? { timeZone } : {}),
        })
        timeFormatters.set(key, formatter)
    }
    return formatter.format(date)
}

const domain = (minimum: number, maximum: number): YAxisDomain => {
    if (minimum === Number.POSITIVE_INFINITY) return { max: 1, min: 0 }
    if (minimum === maximum) {
        const padding = Math.abs(minimum) * 0.1 || 1
        return { max: maximum + padding, min: minimum - padding }
    }
    return { max: maximum, min: minimum }
}

export type TimeFormatContext = {
    locale: string
    timezone?: Timezone
}
