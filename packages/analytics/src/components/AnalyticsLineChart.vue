<script setup lang="ts">
import { computed, defineAsyncComponent, onMounted, ref } from 'vue'
import type { VueUiXyConfig, VueUiXyDatasetItem } from 'vue-data-ui'

import type {
    AnalyticsReportQuality,
    AnalyticsSeriesPoint,
    AnalyticsSeriesReport,
} from '../core/types'
import {
    defaultChartColors,
    formatMetricName,
    formatMetricValue,
    qualityMessages,
    resolveSeriesMetrics,
    type AnalyticsChartSeries,
    type AnalyticsLineChartProps,
} from '../vue-ui'

const props = withDefaults(defineProps<AnalyticsLineChartProps>(), {
    height: 360,
    smooth: false,
})

defineSlots<{
    chart(properties: {
        metrics: readonly string[]
        points: readonly AnalyticsSeriesPoint[]
        series: readonly AnalyticsChartSeries[]
        times: readonly string[]
    }): unknown
    empty(properties: { reason: 'empty' | 'kind' }): unknown
    quality(properties: { messages: readonly string[]; quality: AnalyticsReportQuality }): unknown
    title(properties: { title: string }): unknown
}>()

const mounted = ref(false)
onMounted(() => {
    mounted.value = true
})

const ClientVueUiXy =
    typeof window === 'undefined'
        ? undefined
        : defineAsyncComponent(() => import('vue-data-ui/vue-ui-xy').then(({ VueUiXy }) => VueUiXy))

const seriesReport = computed<AnalyticsSeriesReport | undefined>(() =>
    props.report.kind === 'series' ? props.report : undefined,
)
const selectedMetrics = computed(() => resolveSeriesMetrics(props.report, props.metrics))
const colors = computed(() => props.colors ?? defaultChartColors)
const chartSeries = computed<AnalyticsChartSeries[]>(() => {
    const report = seriesReport.value
    if (!report) return []
    return selectedMetrics.value.map((metric, index) => ({
        ...(colors.value.length > 0 ? { color: colors.value[index % colors.value.length] } : {}),
        metric,
        name: formatMetricName(metric),
        values: report.points.map((point) => {
            const value = point.values[metric]
            return typeof value === 'number' && Number.isFinite(value) ? value : null
        }),
    }))
})
const dataset = computed<VueUiXyDatasetItem[]>(() =>
    chartSeries.value.map((series) => ({
        ...(series.color ? { color: series.color } : {}),
        name: series.name,
        series: [...series.values],
        type: 'line',
    })),
)
const times = computed(() => seriesReport.value?.points.map((point) => point.time) ?? [])
const config = computed<VueUiXyConfig>(() => ({
    chart: {
        grid: {
            labels: {
                xAxisLabels: {
                    values: times.value,
                },
            },
        },
        height: props.height,
        title: { show: false },
        userOptions: { show: false },
    },
    line: { smooth: props.smooth, useGradient: false },
    responsive: true,
}))
const label = computed(() => props.title ?? 'Analytics line chart')
const messages = computed(() => qualityMessages(props.report.meta.quality))
const isEmpty = computed(
    () =>
        seriesReport.value !== undefined &&
        (seriesReport.value.points.length === 0 || selectedMetrics.value.length === 0),
)

function pointKey(point: AnalyticsSeriesPoint): string {
    return `${point.time}:${JSON.stringify(point.dimensions ?? {})}`
}

function formatPoint(point: AnalyticsSeriesPoint): string {
    return selectedMetrics.value
        .map((metric) => `${formatMetricName(metric)}: ${formatMetricValue(point.values[metric])}`)
        .join(', ')
}
</script>

<template>
    <slot v-if="!seriesReport" name="empty" reason="kind">
        <div :aria-label="label" aria-live="polite" class="analytics-empty-state" role="status">
            <strong>{{ label }}</strong>
            <span>No time series data</span>
        </div>
    </slot>

    <slot v-else-if="isEmpty" name="empty" reason="empty">
        <div :aria-label="label" aria-live="polite" class="analytics-empty-state" role="status">
            <strong>{{ label }}</strong>
            <span>No data</span>
        </div>
    </slot>

    <section v-else :aria-label="label" class="analytics-line-chart">
        <slot v-if="props.title" name="title" :title="props.title">
            <h3 class="analytics-line-chart__title">{{ props.title }}</h3>
        </slot>

        <div class="analytics-line-chart__canvas" :style="{ minHeight: `${props.height}px` }">
            <slot
                name="chart"
                :metrics="selectedMetrics"
                :points="seriesReport.points"
                :series="chartSeries"
                :times="times"
            >
                <ClientVueUiXy
                    v-if="mounted && ClientVueUiXy"
                    :config="config"
                    :dataset="dataset"
                />
                <ol v-else class="analytics-line-chart__fallback">
                    <li v-for="point in seriesReport.points" :key="pointKey(point)">
                        {{ point.time }}: {{ formatPoint(point) }}
                    </li>
                </ol>
            </slot>
        </div>

        <slot
            v-if="messages.length > 0"
            name="quality"
            :messages="messages"
            :quality="props.report.meta.quality"
        >
            <p aria-live="polite" class="analytics-quality" role="status">
                {{ messages.join(' \u00b7 ') }}
            </p>
        </slot>
    </section>
</template>
