<script setup lang="ts">
import { areaY, defineChart, lineY, type ChartPoint } from '@tanstack/charts'
import { d3Curve } from '@tanstack/charts/d3/shape'
import { decorative } from '@tanstack/charts/mark/decorative'
import { scaleLinear } from '@tanstack/charts/scales/linear'
import { tooltip } from '@tanstack/charts/tooltip'
import { Chart } from '@tanstack/charts/vue'
import { curveMonotoneX } from 'd3-shape'
import { computed } from 'vue'

import type { AnalyticsSeriesPoint } from '../core/types'
import {
    createAnalyticsChartTooltip,
    createAnalyticsSeriesPresentation,
    formatAnalyticsAxisTime,
    formatAnalyticsSeriesPointTime,
    formatMetricValue,
    formatNumber,
    qualityMessages,
    type AnalyticsChartTooltip,
    type AnalyticsSeriesValue,
} from '../presentation'
import {
    resolveAnalyticsUIClass,
    type AnalyticsSeriesChartProps,
    type AnalyticsSeriesChartSlots,
    type AnalyticsSeriesChartUI,
} from '../vue-ui'

defineOptions({ inheritAttrs: false })

interface AnalyticsCartesianChartProps extends AnalyticsSeriesChartProps {
    variant: 'area' | 'line'
}

interface RendererDatum extends AnalyticsSeriesValue {
    color: string
    metric: string
    name: string
}

type RendererPoint = ChartPoint<RendererDatum, number, number>

const props = withDefaults(defineProps<AnalyticsCartesianChartProps>(), {
    height: 360,
    locale: 'en-US',
    smooth: false,
})

defineSlots<AnalyticsSeriesChartSlots>()

const componentClass = computed(() => `analytics-${props.variant}-chart`)
const ui = computed<Required<AnalyticsSeriesChartUI>>(() => ({
    empty: resolveAnalyticsUIClass('analytics-empty-state', props.ui?.empty),
    header: resolveAnalyticsUIClass(`${componentClass.value}__header`, props.ui?.header),
    legend: resolveAnalyticsUIClass(`${componentClass.value}__legend`, props.ui?.legend),
    legendIndicator: resolveAnalyticsUIClass(
        `${componentClass.value}__legend-indicator`,
        props.ui?.legendIndicator,
    ),
    legendItem: resolveAnalyticsUIClass(
        `${componentClass.value}__legend-item`,
        props.ui?.legendItem,
    ),
    plot: resolveAnalyticsUIClass(`${componentClass.value}__plot`, props.ui?.plot),
    quality: resolveAnalyticsUIClass('analytics-quality', props.ui?.quality),
    root: resolveAnalyticsUIClass(componentClass.value, props.ui?.root),
    title: resolveAnalyticsUIClass(`${componentClass.value}__title`, props.ui?.title),
    tooltip: resolveAnalyticsUIClass(`${componentClass.value}__tooltip`, props.ui?.tooltip),
    tooltipItem: resolveAnalyticsUIClass(
        `${componentClass.value}__tooltip-item`,
        props.ui?.tooltipItem,
    ),
    tooltipLabel: resolveAnalyticsUIClass(
        `${componentClass.value}__tooltip-label`,
        props.ui?.tooltipLabel,
    ),
}))
const chartColors = [
    'var(--analytics-chart-1)',
    'var(--analytics-chart-2)',
    'var(--analytics-chart-3)',
    'var(--analytics-chart-4)',
    'var(--analytics-chart-5)',
    'var(--analytics-chart-6)',
]
const presentation = computed(() =>
    createAnalyticsSeriesPresentation(props.report, {
        colors: props.colors ?? chartColors,
        locale: props.locale,
        ...(props.metrics ? { metrics: props.metrics } : {}),
        ...(props.timezone ? { timezone: props.timezone } : {}),
        ...(props.xAxis ? { xAxis: props.xAxis } : {}),
        ...(props.yAxis ? { yAxis: props.yAxis } : {}),
    }),
)
const rendererSeries = computed(() =>
    presentation.value.series.map((series) => ({
        ...series,
        values: series.values.map((value): RendererDatum => ({
            ...value,
            color: series.color,
            metric: series.metric,
            name: series.name,
        })),
    })),
)
const empty = computed(
    () => props.report.points.length === 0 || presentation.value.series.length === 0,
)
const label = computed(
    () => props.title ?? `Analytics ${props.variant === 'line' ? 'line' : 'area'} chart`,
)
const messages = computed(() => qualityMessages(props.report.meta.quality))
const areaBaseline = computed(() => {
    const { max, min } = presentation.value.yDomain
    return min <= 0 && max >= 0 ? 0 : min > 0 ? min : max
})
const curve = computed(() => (props.smooth ? d3Curve(curveMonotoneX) : undefined))
const definition = computed(() => {
    const marks = rendererSeries.value.flatMap((series) => {
        const line = lineY(series.values, {
            ...(curve.value ? { curve: curve.value } : {}),
            id: `line-${series.metric}`,
            stroke: series.color,
            strokeWidth: 2.25,
            x: 'time',
            y: 'value',
        })
        if (props.variant === 'line') return [line]
        return [
            decorative(
                areaY(series.values, {
                    ...(curve.value ? { curve: curve.value } : {}),
                    fill: series.color,
                    fillOpacity: 0.16,
                    id: `area-${series.metric}`,
                    x: 'time',
                    y1: areaBaseline.value,
                    y2: 'value',
                }),
            ),
            line,
        ]
    })
    const { timeDomain, yDomain } = presentation.value
    return defineChart({
        clip: true,
        focus: 'group-x',
        marks,
        maxFocusDistance: Number.POSITIVE_INFINITY,
        scales: {
            x: {
                axis: {
                    line: false,
                    tickLabels: { thin: { minGap: 12, priority: 'ends' } },
                    ticks: {
                        count: Math.max(1, Math.floor(props.xAxis?.maxTicks ?? 6)),
                        format: (value) =>
                            formatAnalyticsAxisTime(
                                props.report,
                                value,
                                props.locale,
                                props.timezone,
                                props.xAxis,
                            ),
                        size: 0,
                    },
                },
                scale: () => scaleLinear().domain(timeDomain),
            },
            y: {
                axis: {
                    line: false,
                    ticks: {
                        count: 5,
                        format: (value) =>
                            props.yAxis?.formatter?.(value) ?? formatNumber(value, props.locale, 2),
                        size: 0,
                    },
                },
                grid: true,
                scale: () => scaleLinear().domain([yDomain.min, yDomain.max]),
            },
        },
        tooltip: {
            anchor: 'group-center',
            className: 'analytics-chart-tooltip-host',
            placement: ['top', 'right', 'left', 'bottom'],
            use: tooltip,
        },
    })
})

function tooltipForPoints(points: readonly RendererPoint[]): AnalyticsChartTooltip | undefined {
    const index = points[0]?.datum.index
    return index === undefined
        ? undefined
        : createAnalyticsChartTooltip(
              props.report,
              presentation.value.series,
              index,
              props.locale,
              props.timezone,
              props.xAxis,
              props.yAxis,
          )
}

function pointKey(point: AnalyticsSeriesPoint): string {
    return `${point.time}:${JSON.stringify(point.dimensions ?? {})}`
}

function formatPointTime(index: number): string {
    return formatAnalyticsSeriesPointTime(
        props.report,
        index,
        props.locale,
        props.timezone,
        props.xAxis,
    )
}

function formatPointValue(point: AnalyticsSeriesPoint, metric: string): string {
    const value = point.values[metric]
    return value === null || value === undefined
        ? 'No data'
        : (props.yAxis?.formatter?.(value) ?? formatMetricValue(value, props.locale))
}
</script>

<template>
    <section
        v-bind="$attrs"
        :aria-label="String($attrs['aria-label'] ?? label)"
        :class="[ui.root, props.class]"
        :data-slot="String($attrs['data-slot'] ?? 'root')"
    >
        <header v-if="props.title || !empty" :class="ui.header" data-slot="header">
            <slot v-if="props.title" name="title" :title="props.title">
                <h3 :class="ui.title" data-slot="title">{{ props.title }}</h3>
            </slot>

            <slot v-if="!empty" name="legend" :series="presentation.series">
                <ul :class="ui.legend" data-slot="legend">
                    <li
                        v-for="series in presentation.series"
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
            :class="ui.plot"
            data-slot="plot"
            :style="{ height: `${props.height}px`, minHeight: `${props.height}px` }"
        >
            <slot v-if="empty" name="empty" message="No data">
                <div aria-live="polite" :class="ui.empty" data-slot="empty" role="status">
                    <strong>{{ label }}</strong>
                    <span>No data</span>
                </div>
            </slot>

            <Chart
                v-else
                :aria-label="label"
                class="analytics-chart__renderer"
                class-name="analytics-chart__svg"
                :definition
                :height="props.height"
                :initial-width="640"
            >
                <template #tooltipBody="{ points }">
                    <template v-for="tooltipModel in [tooltipForPoints(points)]">
                        <slot
                            v-if="tooltipModel"
                            name="tooltip"
                            :label="tooltipModel.label"
                            :point="tooltipModel.point"
                            :values="tooltipModel.values"
                        >
                            <div :class="ui.tooltip" data-slot="tooltip">
                                <p :class="ui.tooltipLabel" data-slot="tooltip-label">
                                    {{ tooltipModel.label }}
                                </p>
                                <ul>
                                    <li
                                        v-for="item in tooltipModel.values"
                                        :key="item.metric"
                                        :class="ui.tooltipItem"
                                        data-slot="tooltip-item"
                                    >
                                        <span>
                                            <span
                                                aria-hidden="true"
                                                :class="ui.legendIndicator"
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
                </template>
            </Chart>
        </div>

        <table v-if="!empty" class="analytics-chart__data analytics-sr-only">
            <caption>
                {{
                    label
                }}
                data
            </caption>
            <thead>
                <tr>
                    <th scope="col">Time</th>
                    <th v-for="series in presentation.series" :key="series.metric" scope="col">
                        {{ series.name }}
                    </th>
                </tr>
            </thead>
            <tbody>
                <tr v-for="(point, index) in props.report.points" :key="pointKey(point)">
                    <th scope="row">{{ formatPointTime(index) }}</th>
                    <td v-for="series in presentation.series" :key="series.metric">
                        {{ formatPointValue(point, series.metric) }}
                    </td>
                </tr>
            </tbody>
        </table>

        <slot
            v-if="messages.length > 0"
            name="quality"
            :messages
            :quality="props.report.meta.quality"
        >
            <p aria-live="polite" :class="ui.quality" data-slot="quality" role="status">
                {{ messages.join(' \u00b7 ') }}
            </p>
        </slot>
    </section>
</template>
