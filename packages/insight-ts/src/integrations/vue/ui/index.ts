// oxlint-disable-next-line import/no-unassigned-import -- importing the UI entry intentionally loads its base styles
import './style.css'

export type {
    ChartSeries,
    ChartTooltipModel,
    ChartTooltipValue,
    DataNotice,
    TimeFormatContext,
    Timezone,
    XAxisOptions,
    YAxisDomain,
    YAxisOptions,
} from '../../../ui-core/index.ts'
export {
    type InsightAreaChartProps,
    type InsightAreaChartUI,
    type InsightBreakdownTableProps,
    type InsightBreakdownTableUI,
    type InsightLineChartProps,
    type InsightLineChartUI,
    type InsightSeriesChartProps,
    type InsightSeriesChartUI,
    type InsightStatProps,
    type InsightStatUI,
    type InsightUIClass,
} from './types.ts'
export { default as InsightAreaChart } from './components/InsightAreaChart.vue'
export { default as InsightBreakdownTable } from './components/InsightBreakdownTable.vue'
export { default as InsightLineChart } from './components/InsightLineChart.vue'
export { default as InsightStat } from './components/InsightStat.vue'
