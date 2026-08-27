<script setup lang="ts">
import { computed, defineAsyncComponent, onMounted, ref } from 'vue'
import type { VueUiXyConfig, VueUiXyDatasetItem } from 'vue-data-ui'

import type {
    AnalyticsReportQuality,
    AnalyticsSeriesPoint,
    AnalyticsSeriesReport,
} from '../core/types'
import {
    createAnalyticsTimeFormatContext,
    createAnalyticsTimeLabels,
    defaultChartColors,
    formatAnalyticsTime,
    formatMetricName,
    formatMetricValue,
    qualityMessages,
    resolveAnalyticsTimezone,
    resolveAnalyticsUIClass,
    resolveSeriesMetrics,
    resolveYAxisDomain,
    type AnalyticsChartSeries,
    type AnalyticsChartTooltipValue,
    type AnalyticsLineChartProps,
    type AnalyticsLineChartUI,
    type AnalyticsTimezone,
    type AnalyticsYAxisDomain,
} from '../vue-ui'

defineOptions({ inheritAttrs: false })

const props = withDefaults(defineProps<AnalyticsLineChartProps>(), {
    height: 360,
    locale: 'en-US',
    smooth: false,
})

type ResolvedUI = Readonly<Required<AnalyticsLineChartUI>>

defineSlots<{
    chart(properties: {
        labels: readonly string[]
        metrics: readonly string[]
        points: readonly AnalyticsSeriesPoint[]
        series: readonly AnalyticsChartSeries[]
        times: readonly string[]
        timezone: AnalyticsTimezone
        ui: ResolvedUI
        yDomain: AnalyticsYAxisDomain
    }): unknown
    empty(properties: { reason: 'empty' | 'kind'; ui: ResolvedUI }): unknown
    legend(properties: { series: readonly AnalyticsChartSeries[]; ui: ResolvedUI }): unknown
    quality(properties: {
        messages: readonly string[]
        quality: AnalyticsReportQuality
        ui: ResolvedUI
    }): unknown
    title(properties: { title: string; ui: ResolvedUI }): unknown
    tooltip(properties: {
        label: string
        point: AnalyticsSeriesPoint
        ui: ResolvedUI
        values: readonly AnalyticsChartTooltipValue[]
    }): unknown
}>()

const mounted = ref(false)
onMounted(() => {
    mounted.value = true
})

const ClientVueUiXy =
    typeof window === 'undefined'
        ? undefined
        : defineAsyncComponent(() => import('vue-data-ui/vue-ui-xy').then(({ VueUiXy }) => VueUiXy))

const ui = computed<ResolvedUI>(() => ({
    chart: resolveAnalyticsUIClass('analytics-line-chart__canvas', props.ui?.chart),
    empty: resolveAnalyticsUIClass('analytics-empty-state', props.ui?.empty),
    header: resolveAnalyticsUIClass('analytics-line-chart__header', props.ui?.header),
    legend: resolveAnalyticsUIClass('analytics-line-chart__legend', props.ui?.legend),
    legendIndicator: resolveAnalyticsUIClass(
        'analytics-line-chart__legend-indicator',
        props.ui?.legendIndicator,
    ),
    legendItem: resolveAnalyticsUIClass('analytics-line-chart__legend-item', props.ui?.legendItem),
    quality: resolveAnalyticsUIClass('analytics-quality', props.ui?.quality),
    root: resolveAnalyticsUIClass('analytics-line-chart', props.ui?.root),
    title: resolveAnalyticsUIClass('analytics-line-chart__title', props.ui?.title),
    tooltip: resolveAnalyticsUIClass('analytics-line-chart__tooltip', props.ui?.tooltip),
    tooltipLabel: resolveAnalyticsUIClass(
        'analytics-line-chart__tooltip-label',
        props.ui?.tooltipLabel,
    ),
    tooltipValue: resolveAnalyticsUIClass(
        'analytics-line-chart__tooltip-value',
        props.ui?.tooltipValue,
    ),
}))
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
        dataLabels: false,
        name: series.name,
        series: [...series.values],
        type: 'line',
    })),
)
const times = computed(() => seriesReport.value?.points.map((point) => point.time) ?? [])
const timezone = computed(() => resolveAnalyticsTimezone(props.report, props.timezone))
const labels = computed(() =>
    seriesReport.value
        ? createAnalyticsTimeLabels(seriesReport.value, props.locale, props.timezone, props.xAxis)
        : [],
)
const yDomain = computed(() => resolveYAxisDomain(chartSeries.value, props.yAxis))
const config = computed<VueUiXyConfig>(() => ({
    chart: {
        backgroundColor: 'transparent',
        color: 'var(--analytics-text)',
        grid: {
            stroke: 'var(--analytics-chart-grid)',
            labels: {
                color: 'var(--analytics-chart-axis)',
                fontSize: 12,
                xAxisLabels: {
                    color: 'var(--analytics-chart-axis)',
                    fontSize: 12,
                    values: labels.value,
                },
                yAxis: {
                    ...(props.yAxis?.formatter
                        ? { formatter: ({ value }) => props.yAxis?.formatter?.(value) ?? value }
                        : {}),
                    scaleMax: yDomain.value.max,
                    scaleMin: yDomain.value.min,
                },
            },
        },
        height: props.height,
        legend: { show: false },
        title: { show: false },
        tooltip: { show: true, showTimeLabel: false },
        userOptions: { show: false },
        zoom: { show: false },
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

function formatPointTime(point: AnalyticsSeriesPoint, index: number): string {
    const context = createAnalyticsTimeFormatContext(
        props.report,
        index,
        props.locale,
        props.timezone,
    )
    const date = new Date(point.time)
    return props.xAxis?.formatter?.(date, context) ?? formatAnalyticsTime(date, context)
}

function formatPoint(point: AnalyticsSeriesPoint): string {
    return selectedMetrics.value
        .map(
            (metric) =>
                `${formatMetricName(metric)}: ${formatMetricValue(point.values[metric], props.locale)}`,
        )
        .join(', ')
}

function tooltipAt(index: number):
    | {
          label: string
          point: AnalyticsSeriesPoint
          values: readonly AnalyticsChartTooltipValue[]
      }
    | undefined {
    const point = seriesReport.value?.points[index]
    if (!point) return undefined
    return {
        label: formatPointTime(point, index),
        point,
        values: chartSeries.value.map((series) => {
            const value = point.values[series.metric]
            return {
                ...(series.color ? { color: series.color } : {}),
                formatted:
                    value === null || value === undefined
                        ? 'No data'
                        : (props.yAxis?.formatter?.(value) ??
                          formatMetricValue(value, props.locale)),
                metric: series.metric,
                name: series.name,
                value: value ?? null,
            }
        }),
    }
}

function tooltipPointAt(index: number): AnalyticsSeriesPoint {
    return tooltipAt(index)?.point as AnalyticsSeriesPoint
}
</script>

<template>
    <section
        v-bind="$attrs"
        :aria-label="String($attrs['aria-label'] ?? label)"
        :class="[ui.root, props.class]"
        :data-slot="String($attrs['data-slot'] ?? 'root')"
    >
        <slot v-if="!seriesReport" name="empty" reason="kind" :ui>
            <div aria-live="polite" :class="ui.empty" data-slot="empty" role="status">
                <strong>{{ label }}</strong>
                <span>No time series data</span>
            </div>
        </slot>

        <slot v-else-if="isEmpty" name="empty" reason="empty" :ui>
            <div aria-live="polite" :class="ui.empty" data-slot="empty" role="status">
                <strong>{{ label }}</strong>
                <span>No data</span>
            </div>
        </slot>

        <template v-else>
            <header :class="ui.header" data-slot="header">
                <slot v-if="props.title" name="title" :title="props.title" :ui>
                    <h3 :class="ui.title" data-slot="title">{{ props.title }}</h3>
                </slot>

                <slot name="legend" :series="chartSeries" :ui>
                    <ul :class="ui.legend" data-slot="legend">
                        <li
                            v-for="series in chartSeries"
                            :key="series.metric"
                            :class="ui.legendItem"
                            data-slot="legend-item"
                        >
                            <span
                                aria-hidden="true"
                                :class="ui.legendIndicator"
                                data-slot="legend-indicator"
                                :style="{ backgroundColor: series.color }"
                            />
                            <span>{{ series.name }}</span>
                        </li>
                    </ul>
                </slot>
            </header>

            <div
                :class="ui.chart"
                data-slot="chart"
                :style="{
                    height: `${props.height}px`,
                    minHeight: `${props.height}px`,
                    width: '100%',
                }"
            >
                <slot
                    name="chart"
                    :labels
                    :metrics="selectedMetrics"
                    :points="seriesReport.points"
                    :series="chartSeries"
                    :times
                    :timezone
                    :ui
                    :y-domain="yDomain"
                >
                    <ClientVueUiXy v-if="mounted && ClientVueUiXy" :config :dataset>
                        <template #tooltip="{ absoluteIndex }">
                            <slot
                                v-if="tooltipAt(absoluteIndex)"
                                name="tooltip"
                                :label="tooltipAt(absoluteIndex)?.label ?? ''"
                                :point="tooltipPointAt(absoluteIndex)"
                                :ui
                                :values="tooltipAt(absoluteIndex)?.values ?? []"
                            >
                                <div :class="ui.tooltip" data-slot="tooltip">
                                    <p :class="ui.tooltipLabel" data-slot="tooltip-label">
                                        {{ tooltipAt(absoluteIndex)?.label }}
                                    </p>
                                    <ul>
                                        <li
                                            v-for="item in tooltipAt(absoluteIndex)?.values"
                                            :key="item.metric"
                                            :class="ui.tooltipValue"
                                            data-slot="tooltip-value"
                                        >
                                            <span>
                                                <span
                                                    aria-hidden="true"
                                                    :class="ui.legendIndicator"
                                                    data-slot="legend-indicator"
                                                    :style="{ backgroundColor: item.color }"
                                                />
                                                {{ item.name }}
                                            </span>
                                            <strong>{{ item.formatted }}</strong>
                                        </li>
                                    </ul>
                                </div>
                            </slot>
                        </template>
                    </ClientVueUiXy>
                    <ol v-else class="analytics-line-chart__fallback">
                        <li v-for="(point, index) in seriesReport.points" :key="pointKey(point)">
                            {{ formatPointTime(point, index) }}: {{ formatPoint(point) }}
                        </li>
                    </ol>
                </slot>
            </div>

            <slot
                v-if="messages.length > 0"
                name="quality"
                :messages
                :quality="props.report.meta.quality"
                :ui
            >
                <p aria-live="polite" :class="ui.quality" data-slot="quality" role="status">
                    {{ messages.join(' \u00b7 ') }}
                </p>
            </slot>
        </template>
    </section>
</template>
