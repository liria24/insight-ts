import type {
    AnalyticsReportQuality,
    AnalyticsScalarReport,
    AnalyticsSeriesPoint,
    AnalyticsSeriesReport,
    AnalyticsTableReport,
} from './core/types'
import type {
    AnalyticsChartSeries,
    AnalyticsChartTooltipValue,
    AnalyticsTimezone,
    AnalyticsXAxisOptions,
    AnalyticsYAxisOptions,
} from './presentation'

export type AnalyticsUIClass = string | readonly string[]

export interface AnalyticsStatUI {
    root?: AnalyticsUIClass
    label?: AnalyticsUIClass
    value?: AnalyticsUIClass
    quality?: AnalyticsUIClass
    empty?: AnalyticsUIClass
}

export interface AnalyticsSeriesChartUI {
    root?: AnalyticsUIClass
    header?: AnalyticsUIClass
    title?: AnalyticsUIClass
    plot?: AnalyticsUIClass
    legend?: AnalyticsUIClass
    legendItem?: AnalyticsUIClass
    legendIndicator?: AnalyticsUIClass
    tooltip?: AnalyticsUIClass
    tooltipLabel?: AnalyticsUIClass
    tooltipItem?: AnalyticsUIClass
    quality?: AnalyticsUIClass
    empty?: AnalyticsUIClass
}

export type AnalyticsLineChartUI = AnalyticsSeriesChartUI
export type AnalyticsAreaChartUI = AnalyticsSeriesChartUI

export interface AnalyticsBreakdownTableUI {
    root?: AnalyticsUIClass
    table?: AnalyticsUIClass
    header?: AnalyticsUIClass
    body?: AnalyticsUIClass
    row?: AnalyticsUIClass
    headerCell?: AnalyticsUIClass
    cell?: AnalyticsUIClass
    quality?: AnalyticsUIClass
    empty?: AnalyticsUIClass
}

export interface AnalyticsStatProps {
    class?: AnalyticsUIClass
    emptyText?: string
    label?: string
    locale?: string
    maximumFractionDigits?: number
    metric: string
    report: AnalyticsScalarReport
    ui?: AnalyticsStatUI
}

export interface AnalyticsSeriesChartProps {
    class?: AnalyticsUIClass | undefined
    colors?: readonly string[] | undefined
    height?: number | undefined
    locale?: string | undefined
    metrics?: readonly string[] | undefined
    report: AnalyticsSeriesReport
    smooth?: boolean | undefined
    timezone?: AnalyticsTimezone | undefined
    title?: string | undefined
    ui?: AnalyticsSeriesChartUI | undefined
    xAxis?: AnalyticsXAxisOptions | undefined
    yAxis?: AnalyticsYAxisOptions | undefined
}

export type AnalyticsLineChartProps = AnalyticsSeriesChartProps
export type AnalyticsAreaChartProps = AnalyticsSeriesChartProps

export interface AnalyticsBreakdownTableProps {
    class?: AnalyticsUIClass
    dimensions?: readonly string[]
    emptyText?: string
    locale?: string
    maximumFractionDigits?: number
    metrics?: readonly string[]
    report: AnalyticsTableReport
    ui?: AnalyticsBreakdownTableUI
}

export interface AnalyticsSeriesChartSlots {
    empty(properties: { message: string }): unknown
    legend(properties: { series: readonly AnalyticsChartSeries[] }): unknown
    quality(properties: { messages: readonly string[]; quality: AnalyticsReportQuality }): unknown
    title(properties: { title: string }): unknown
    tooltip(properties: {
        label: string
        point: AnalyticsSeriesPoint
        values: readonly AnalyticsChartTooltipValue[]
    }): unknown
}

export function resolveAnalyticsUIClass(
    base: string,
    custom?: AnalyticsUIClass,
): readonly string[] {
    return custom === undefined
        ? [base]
        : [base, ...(typeof custom === 'string' ? [custom] : custom)]
}
