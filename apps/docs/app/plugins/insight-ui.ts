import {
    InsightBarList,
    InsightBreakdownTable,
    InsightChart,
    InsightSparkline,
    InsightStat,
} from 'insight-ts/vue/ui'

export default defineNuxtPlugin(({ vueApp }) => {
    vueApp.component('InsightBarList', InsightBarList)
    vueApp.component('InsightBreakdownTable', InsightBreakdownTable)
    vueApp.component('InsightChart', InsightChart)
    vueApp.component('InsightSparkline', InsightSparkline)
    vueApp.component('InsightStat', InsightStat)
})
