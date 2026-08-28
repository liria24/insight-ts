<script setup lang="ts">
import { h, useAttrs, useSlots } from 'vue'

import type { AnalyticsAreaChartProps, AnalyticsSeriesChartSlots } from '../vue-ui'
import AnalyticsCartesianChart from './AnalyticsCartesianChart.vue'

defineOptions({ inheritAttrs: false })

const props = defineProps<AnalyticsAreaChartProps>()
defineSlots<AnalyticsSeriesChartSlots>()
const attrs = useAttrs()
const slots = useSlots()
const ForwardedChart = () =>
    h(AnalyticsCartesianChart, { ...attrs, ...props, variant: 'area' }, slots)
</script>

<template>
    <ForwardedChart />
</template>
