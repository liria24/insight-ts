// oxlint-disable-next-line import/no-unassigned-import -- importing the UI entry intentionally loads its base styles
import './style.css'

export type {
    AnalyticsChartSeries,
    AnalyticsChartTooltipValue,
    AnalyticsTimeFormatContext,
    AnalyticsTimezone,
    AnalyticsXAxisOptions,
    AnalyticsYAxisDomain,
    AnalyticsYAxisOptions,
} from './presentation'
export {
    type AnalyticsAreaChartProps,
    type AnalyticsAreaChartUI,
    type AnalyticsBreakdownTableProps,
    type AnalyticsBreakdownTableUI,
    type AnalyticsLineChartProps,
    type AnalyticsLineChartUI,
    type AnalyticsSeriesChartProps,
    type AnalyticsSeriesChartUI,
    type AnalyticsStatProps,
    type AnalyticsStatUI,
    type AnalyticsUIClass,
} from './vue-ui'
export { default as AnalyticsAreaChart } from './components/AnalyticsAreaChart.vue'
export { default as AnalyticsBreakdownTable } from './components/AnalyticsBreakdownTable.vue'
export { default as AnalyticsLineChart } from './components/AnalyticsLineChart.vue'
export { default as AnalyticsStat } from './components/AnalyticsStat.vue'
