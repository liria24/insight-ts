<script setup lang="ts">
import type { InsightLineChartProps, InsightSeriesChartSlots } from '../types.ts'
import InsightCartesianChart from './InsightCartesianChart.vue'

defineOptions({ inheritAttrs: false })
const props = defineProps<InsightLineChartProps>()
defineSlots<InsightSeriesChartSlots>()
</script>

<template>
    <InsightCartesianChart v-bind="{ ...$attrs, ...props }" variant="line">
        <template v-if="$slots.title" #title="slotProps"
            ><slot name="title" v-bind="slotProps"
        /></template>
        <template v-if="$slots.legend" #legend="slotProps"
            ><slot name="legend" v-bind="slotProps"
        /></template>
        <template v-if="$slots.tooltip" #tooltip="slotProps"
            ><slot name="tooltip" v-bind="slotProps"
        /></template>
        <template v-if="$slots.notices" #notices="slotProps"
            ><slot name="notices" v-bind="slotProps"
        /></template>
        <template v-if="$slots.empty" #empty="slotProps"
            ><slot name="empty" v-bind="slotProps"
        /></template>
    </InsightCartesianChart>
</template>
