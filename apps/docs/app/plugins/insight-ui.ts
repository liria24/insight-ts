import {
    InsightAreaChart,
    InsightBarChart,
    InsightBreakdownTable,
    InsightLineChart,
    InsightQualityNotice,
    InsightSparkline,
    InsightStat,
} from 'insight-ts/vue/ui'

export default defineNuxtPlugin(({ vueApp }) => {
    vueApp.component('InsightAreaChart', InsightAreaChart)
    vueApp.component('InsightBarChart', InsightBarChart)
    vueApp.component('InsightBreakdownTable', InsightBreakdownTable)
    vueApp.component('InsightLineChart', InsightLineChart)
    vueApp.component('InsightQualityNotice', InsightQualityNotice)
    vueApp.component('InsightSparkline', InsightSparkline)
    vueApp.component('InsightStat', InsightStat)
})
