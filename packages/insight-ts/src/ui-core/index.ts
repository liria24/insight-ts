import type {
    DimensionValues,
    Grain,
    HistoryFidelityBand,
    HistoryTransformation,
    MetricValues,
    Report,
    ReportMeta,
    ScalarReport,
    SeriesPoint,
    SeriesReport,
    TableReport,
    TimeRange,
} from '../core/types.ts'

export type Timezone = 'local' | (string & Record<never, never>)

export interface TimeFormatContext {
    grain?: Grain
    index: number
    locale: string
    timezone: Timezone
}

export interface XAxisOptions {
    formatter?: (date: Date, context: TimeFormatContext) => string
    maxTicks?: number
}

export interface YAxisOptions {
    formatter?: (value: number) => string
    includeZero?: boolean
    max?: number
    min?: number
    padding?: number
}

export interface SeriesValue<TMetric extends string = string, TDimension extends string = string> {
    index: number
    point: SeriesPoint<TMetric, TDimension>
    time: number
    value: number | null
}

export interface ChartSeries<TMetric extends string = string, TDimension extends string = string> {
    color: string
    metric: TMetric
    name: string
    values: readonly SeriesValue<TMetric, TDimension>[]
}

export interface ChartTooltipValue<TMetric extends string = string> {
    color: string
    formatted: string
    metric: TMetric
    name: string
    value: number | null
}

export interface ChartTooltipModel<
    TMetric extends string = string,
    TDimension extends string = string,
> {
    label: string
    point: SeriesPoint<TMetric, TDimension>
    values: readonly ChartTooltipValue<TMetric>[]
}

export interface YAxisDomain {
    max: number
    min: number
}

export interface FidelityBandModel {
    from: number
    range: TimeRange
    to: number
    transformations: readonly HistoryTransformation[]
}

export interface SeriesModel<TMetric extends string = string, TDimension extends string = string> {
    fidelityBands: readonly FidelityBandModel[]
    labels: readonly string[]
    metrics: readonly TMetric[]
    series: readonly ChartSeries<TMetric, TDimension>[]
    timeDomain: readonly [number, number]
    timezone: Timezone
    yDomain: YAxisDomain
}

export interface SeriesModelOptions<TMetric extends string = string> {
    colors?: readonly string[]
    locale?: string
    metrics?: readonly TMetric[]
    timezone?: Timezone
    xAxis?: XAxisOptions
    yAxis?: YAxisOptions
}

export interface StatModel<TMetric extends string = string> {
    metric: TMetric
    value: number | null
}

export interface BreakdownModel<
    TMetric extends string = string,
    TDimension extends string = string,
> {
    dimensions: readonly TDimension[]
    metrics: readonly TMetric[]
}

export type DataNotice =
    | {
          kind: 'approximate' | 'partial' | 'sampled' | 'thresholded'
          sampleRate?: number
          source: 'provider'
      }
    | { code: string; kind: 'warning'; message: string; source: 'provider' }
    | {
          kind: HistoryTransformation['kind']
          range: TimeRange
          source: 'history'
          transformation: HistoryTransformation
      }

export const defaultChartColors = ['#6376dd', '#43a047', '#fb8c00', '#8e24aa', '#00838f', '#d81b60']

export function createSeriesModel<
    TMetric extends string,
    TDimension extends string,
    TSource extends string,
>(
    report: SeriesReport<TMetric, TDimension, TSource>,
    options: SeriesModelOptions<TMetric> = {},
): SeriesModel<TMetric, TDimension> {
    const locale = options.locale ?? 'en-US'
    const metrics = selectSeriesMetrics(report, options.metrics)
    const colors = options.colors?.length ? options.colors : defaultChartColors
    const points = report.points
        .map((point, index) => ({ index, point, time: new Date(point.time).valueOf() }))
        .filter(({ time }) => Number.isFinite(time))
        // oxlint-disable-next-line unicorn/no-array-sort -- this is a private copy
        .sort((left, right) => left.time - right.time || left.index - right.index)
    const series = metrics.map((metric, index): ChartSeries<TMetric, TDimension> => ({
        color: colors[index % colors.length]!,
        metric,
        name: formatMetricName(metric),
        values: points.map(({ index: pointIndex, point, time }) => ({
            index: pointIndex,
            point,
            time,
            value: finiteMetric(point.values[metric]),
        })),
    }))
    return {
        fidelityBands: fidelityBands(report.meta.fidelity),
        labels: points.map(({ index }) =>
            formatSeriesPointTime(report, index, locale, options.timezone, options.xAxis),
        ),
        metrics,
        series,
        timeDomain: resolveTimeDomain(
            report,
            points.map(({ time }) => time),
        ),
        timezone: resolveTimezone(report, options.timezone),
        yDomain: resolveYAxisDomain(series, options.yAxis),
    }
}

export function createStatModel<TMetric extends string>(
    report: ScalarReport<TMetric>,
    metric: TMetric,
): StatModel<TMetric> | undefined {
    return Object.hasOwn(report.values, metric)
        ? { metric, value: finiteMetric(report.values[metric]) }
        : undefined
}

export function createBreakdownModel<TMetric extends string, TDimension extends string>(
    report: TableReport<TMetric, TDimension>,
    options: { dimensions?: readonly TDimension[]; metrics?: readonly TMetric[] } = {},
): BreakdownModel<TMetric, TDimension> {
    return {
        dimensions: selectTableFields(report, options.dimensions, 'dimensions'),
        metrics: selectTableFields(report, options.metrics, 'metrics'),
    }
}

export function createDataNotices(meta: Pick<ReportMeta, 'fidelity' | 'quality'>): DataNotice[] {
    const quality = meta.quality
    return [
        ...(quality.partial ? [{ kind: 'partial', source: 'provider' } as const] : []),
        ...(quality.approximate ? [{ kind: 'approximate', source: 'provider' } as const] : []),
        ...(quality.sampled
            ? [
                  {
                      kind: 'sampled',
                      ...(quality.sampleRate === undefined
                          ? {}
                          : { sampleRate: quality.sampleRate }),
                      source: 'provider',
                  } as const,
              ]
            : []),
        ...(quality.thresholded ? [{ kind: 'thresholded', source: 'provider' } as const] : []),
        ...(quality.warnings ?? []).map(({ code, message }) => ({
            code,
            kind: 'warning' as const,
            message,
            source: 'provider' as const,
        })),
        ...(meta.fidelity ?? []).flatMap(({ range, transformations }) =>
            transformations.map((transformation) => ({
                kind: transformation.kind,
                range,
                source: 'history' as const,
                transformation,
            })),
        ),
    ]
}

export function formatDataNotice(notice: DataNotice, locale = 'en-US'): string {
    if (notice.source === 'provider') {
        if (notice.kind === 'warning') return notice.message
        if (notice.kind === 'sampled' && notice.sampleRate !== undefined) {
            return `Sampled data (${new Intl.NumberFormat(locale, { style: 'percent' }).format(notice.sampleRate)})`
        }
        return `${notice.kind[0]!.toUpperCase()}${notice.kind.slice(1)} data`
    }
    return `History ${notice.kind.replace('-', ' ')} (${notice.range.from} – ${notice.range.to})`
}

export function selectSeriesMetrics<TMetric extends string>(
    report: SeriesReport<TMetric>,
    requested?: readonly TMetric[],
): TMetric[] {
    const available = new Set<TMetric>(
        report.points.flatMap((point) =>
            recordKeys<TMetric>(point.values).flatMap((metric) =>
                finiteMetric(point.values[metric]) === null ? [] : [metric],
            ),
        ),
    )
    return unique(requested?.length ? requested : [...available]).filter((metric) =>
        available.has(metric),
    )
}

export function selectTableFields<TMetric extends string, TDimension extends string>(
    report: TableReport<TMetric, TDimension>,
    requested: readonly TDimension[] | undefined,
    field: 'dimensions',
): TDimension[]
export function selectTableFields<TMetric extends string, TDimension extends string>(
    report: TableReport<TMetric, TDimension>,
    requested: readonly TMetric[] | undefined,
    field: 'metrics',
): TMetric[]
export function selectTableFields(
    report: TableReport,
    requested: readonly string[] | undefined,
    field: 'dimensions' | 'metrics',
): string[] {
    const available = new Set(report.rows.flatMap((row) => Object.keys(row[field])))
    return unique(requested?.length ? requested : [...available]).filter((name) =>
        available.has(name),
    )
}

export function resolveTimezone(report: Report, timezone?: Timezone): Timezone {
    return (
        timezone ??
        report.meta.temporal.bucketTimezone ??
        report.meta.temporal.sourceTimezone ??
        'UTC'
    )
}

export function createTimeFormatContext(
    report: Report,
    index: number,
    locale = 'en-US',
    timezone?: Timezone,
): TimeFormatContext {
    const grain = report.meta.temporal.grain
    return {
        ...(grain ? { grain } : {}),
        index,
        locale,
        timezone: resolveTimezone(report, timezone),
    }
}

export function formatTime(date: Date, context: TimeFormatContext): string {
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

export function formatSeriesPointTime(
    report: SeriesReport,
    index: number,
    locale: string,
    timezone?: Timezone,
    options: XAxisOptions = {},
): string {
    const point = report.points[index]
    if (!point) return ''
    const date = new Date(point.time)
    const context = createTimeFormatContext(report, index, locale, timezone)
    return options.formatter?.(date, context) ?? formatTime(date, context)
}

export function formatAxisTime(
    report: SeriesReport,
    time: number,
    locale: string,
    timezone?: Timezone,
    options: XAxisOptions = {},
): string {
    const context = createTimeFormatContext(
        report,
        nearestPointIndex(report, time),
        locale,
        timezone,
    )
    const date = new Date(time)
    return options.formatter?.(date, context) ?? formatTime(date, context)
}

export function createChartTooltipModel<TMetric extends string, TDimension extends string>(
    report: SeriesReport<TMetric, TDimension>,
    series: readonly ChartSeries<TMetric, TDimension>[],
    index: number,
    locale: string,
    timezone?: Timezone,
    xAxis: XAxisOptions = {},
    yAxis: YAxisOptions = {},
): ChartTooltipModel<TMetric, TDimension> | undefined {
    const point = report.points[index]
    if (!point) return undefined
    return {
        label: formatSeriesPointTime(report, index, locale, timezone, xAxis),
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
    series: readonly ChartSeries[],
    options: YAxisOptions = {},
): YAxisDomain {
    const values = series.flatMap(({ values: items }) =>
        items.flatMap(({ value }) => (value === null ? [] : [value])),
    )
    if (values.length === 0) return { min: options.min ?? 0, max: options.max ?? 1 }
    const sourceMin = Math.min(...values)
    const sourceMax = Math.max(...values)
    const nonNegative = sourceMin >= 0
    let min = options.includeZero ? Math.min(sourceMin, 0) : sourceMin
    let max = options.includeZero ? Math.max(sourceMax, 0) : sourceMax
    const padding = Math.max(options.padding ?? 0.05, 0)
    if (min === max) {
        const span = Math.max(Math.abs(min) * 0.05, 1)
        min -= span
        max += span
    } else {
        const span = (max - min) * padding
        min -= span
        max += span
    }
    if (nonNegative && min < 0) min = 0
    min = options.min ?? min
    max = options.max ?? max
    if (min === max) max += Math.max(Math.abs(max) * 0.05, 1)
    return { min, max }
}

export function tableCellValue(
    column: string,
    values: DimensionValues | MetricValues,
): boolean | number | string | null {
    return values[column] ?? null
}

export function formatTableCell(
    value: boolean | number | string | null,
    locale: string,
    maximumFractionDigits: number,
): string {
    return typeof value === 'number' && Number.isFinite(value)
        ? formatNumber(value, locale, maximumFractionDigits)
        : value === null
          ? '\u2014'
          : String(value)
}

export function finiteMetric(value: number | null | undefined): number | null {
    return typeof value === 'number' && Number.isFinite(value) ? value : null
}

export function formatMetricName(metric: string): string {
    return metric
        .replace(/([a-z\d])([A-Z])/g, '$1 $2')
        .replace(/[_-]+/g, ' ')
        .replace(/^./, (value) => value.toUpperCase())
}

export function formatMetricValue(value: number | null | undefined, locale = 'en-US'): string {
    const metric = finiteMetric(value)
    return metric === null ? 'No data' : formatNumber(metric, locale, 2)
}

export function formatNumber(value: number, locale: string, maximumFractionDigits: number): string {
    return new Intl.NumberFormat(locale, { maximumFractionDigits }).format(value)
}

function fidelityBands(bands: readonly HistoryFidelityBand[] | undefined): FidelityBandModel[] {
    return (bands ?? []).flatMap(({ preservation, range, transformations }) => {
        const from = new Date(range.from).valueOf()
        const to = new Date(range.to).valueOf()
        return preservation === 'reduced' && Number.isFinite(from) && Number.isFinite(to)
            ? [{ from, range, to, transformations }]
            : []
    })
}

function resolveTimeDomain(
    report: SeriesReport,
    times: readonly number[],
): readonly [number, number] {
    if (times.length === 0) return [0, 1]
    const min = Math.min(...times)
    const max = Math.max(...times)
    if (min !== max) return [min, max]
    const spans: Partial<Record<Grain, number>> = {
        minute: 60_000,
        hour: 3_600_000,
        day: 86_400_000,
        week: 604_800_000,
        month: 2_592_000_000,
        year: 31_536_000_000,
    }
    const span = spans[report.meta.temporal.grain ?? 'day'] ?? 86_400_000
    return [min - span / 2, max + span / 2]
}

function nearestPointIndex(report: SeriesReport, time: number): number {
    if (report.points.length === 0) return 0
    return report.points.reduce(
        (nearest, point, index) =>
            Math.abs(new Date(point.time).valueOf() - time) <
            Math.abs(new Date(report.points[nearest]!.time).valueOf() - time)
                ? index
                : nearest,
        0,
    )
}

function unique<T>(values: readonly T[]): T[] {
    return [...new Set(values)]
}

const recordKeys = <TKey extends string>(value: Readonly<Record<TKey, unknown>>): TKey[] => {
    // Object.keys cannot preserve a generic Record key in TypeScript.
    // oxlint-disable-next-line typescript/no-unsafe-type-assertion
    return Object.keys(value) as TKey[]
}
