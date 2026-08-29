import type { QueryQuality } from '../../../core/types.ts'
import type {
    ChartSeries,
    ChartTooltipValue,
    DataNotice,
    MetricQueryResult,
    MetricSeriesPoint,
    Timezone,
    XAxisOptions,
    YAxisOptions,
} from '../../../ui-core/index.ts'

export type InsightUIClass = string | readonly string[]

export interface InsightStatUI {
    root?: InsightUIClass
    label?: InsightUIClass
    value?: InsightUIClass
    notices?: InsightUIClass
    empty?: InsightUIClass
}

export interface InsightSeriesChartUI {
    root?: InsightUIClass
    header?: InsightUIClass
    title?: InsightUIClass
    plot?: InsightUIClass
    legend?: InsightUIClass
    legendItem?: InsightUIClass
    legendIndicator?: InsightUIClass
    tooltip?: InsightUIClass
    tooltipLabel?: InsightUIClass
    tooltipItem?: InsightUIClass
    notices?: InsightUIClass
    empty?: InsightUIClass
}

export type InsightLineChartUI = InsightSeriesChartUI
export type InsightAreaChartUI = InsightSeriesChartUI

export interface InsightBreakdownTableUI {
    root?: InsightUIClass
    table?: InsightUIClass
    header?: InsightUIClass
    body?: InsightUIClass
    row?: InsightUIClass
    headerCell?: InsightUIClass
    cell?: InsightUIClass
    notices?: InsightUIClass
    empty?: InsightUIClass
}

export interface InsightStatProps<TData extends MetricQueryResult = MetricQueryResult> {
    class?: InsightUIClass
    data: TData
    emptyText?: string
    formatter?: (value: number) => string
    label?: string
    locale?: string
    maximumFractionDigits?: number
    metric: Extract<keyof TData['data'], string>
    ui?: InsightStatUI
}

export interface InsightSeriesChartProps {
    class?: InsightUIClass | undefined
    colors?: readonly string[] | undefined
    data: MetricQueryResult
    height?: number | undefined
    locale?: string | undefined
    smooth?: boolean | undefined
    timezone?: Timezone | undefined
    title?: string | undefined
    ui?: InsightSeriesChartUI | undefined
    xAxis?: XAxisOptions | undefined
    yAxis?: YAxisOptions | undefined
}

export type InsightLineChartProps = InsightSeriesChartProps
export type InsightAreaChartProps = InsightSeriesChartProps

export interface InsightBreakdownTableProps {
    class?: InsightUIClass
    data: MetricQueryResult
    emptyText?: string
    locale?: string
    maximumFractionDigits?: number
    ui?: InsightBreakdownTableUI
}

export interface InsightBarChartProps<TData extends MetricQueryResult = MetricQueryResult> {
    class?: InsightUIClass
    data: TData
    dimension: TData extends MetricQueryResult<string, infer TDimension> ? TDimension : string
    emptyText?: string
    formatter?: (value: number) => string
    height?: number
    locale?: string
    metric: Extract<keyof TData['data'], string>
}

export interface InsightSparklineProps<TData extends MetricQueryResult = MetricQueryResult> {
    class?: InsightUIClass
    data: TData
    height?: number
    metric: Extract<keyof TData['data'], string>
    width?: number
}

export interface InsightQualityNoticeProps {
    class?: InsightUIClass
    data?: QueryQuality
    locale?: string
}

export interface InsightSeriesChartSlots {
    empty(properties: { message: string }): unknown
    legend(properties: { series: readonly ChartSeries[] }): unknown
    notices(properties: {
        messages: readonly string[]
        notices: readonly DataNotice[]
        quality: QueryQuality | undefined
    }): unknown
    title(properties: { title: string }): unknown
    tooltip(properties: {
        label: string
        point: MetricSeriesPoint
        values: readonly ChartTooltipValue[]
    }): unknown
}

export const resolveInsightUIClass = (base: string, custom?: InsightUIClass): readonly string[] =>
    custom === undefined ? [base] : [base, ...(typeof custom === 'string' ? [custom] : custom)]
