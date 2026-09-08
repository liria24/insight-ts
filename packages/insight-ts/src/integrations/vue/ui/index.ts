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
    type InsightBarListProps,
    type InsightBarListUI,
    type InsightBreakdownTableProps,
    type InsightBreakdownTableUI,
    type InsightChartProps,
    type InsightChartSlots,
    type InsightChartType,
    type InsightChartUI,
    type InsightStatProps,
    type InsightStatUI,
    type InsightSparklineProps,
    type InsightSparklineUI,
    type InsightUIClass,
} from './types.ts'
export { default as InsightBarList } from './components/InsightBarList.vue'
export { default as InsightBreakdownTable } from './components/InsightBreakdownTable.vue'
export { default as InsightChart } from './components/InsightChart.vue'
export { default as InsightSparkline } from './components/InsightSparkline.vue'
export { default as InsightStat } from './components/InsightStat.vue'
