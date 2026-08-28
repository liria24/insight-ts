import type {
    ReportQuality,
    ScalarReport,
    SeriesPoint,
    SeriesReport,
    TableReport,
} from '../../../core/types.ts'
import type {
    ChartSeries,
    ChartTooltipValue,
    DataNotice,
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

export interface InsightStatProps {
    class?: InsightUIClass
    emptyText?: string
    label?: string
    locale?: string
    maximumFractionDigits?: number
    metric: string
    report: ScalarReport
    ui?: InsightStatUI
}

export interface InsightSeriesChartProps {
    class?: InsightUIClass | undefined
    colors?: readonly string[] | undefined
    height?: number | undefined
    locale?: string | undefined
    metrics?: readonly string[] | undefined
    report: SeriesReport
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
    dimensions?: readonly string[]
    emptyText?: string
    locale?: string
    maximumFractionDigits?: number
    metrics?: readonly string[]
    report: TableReport
    ui?: InsightBreakdownTableUI
}

export interface InsightSeriesChartSlots {
    empty(properties: { message: string }): unknown
    legend(properties: { series: readonly ChartSeries[] }): unknown
    notices(properties: {
        messages: readonly string[]
        notices: readonly DataNotice[]
        quality: ReportQuality
    }): unknown
    title(properties: { title: string }): unknown
    tooltip(properties: {
        label: string
        point: SeriesPoint
        values: readonly ChartTooltipValue[]
    }): unknown
}

export const resolveInsightUIClass = (base: string, custom?: InsightUIClass): readonly string[] =>
    custom === undefined ? [base] : [base, ...(typeof custom === 'string' ? [custom] : custom)]
