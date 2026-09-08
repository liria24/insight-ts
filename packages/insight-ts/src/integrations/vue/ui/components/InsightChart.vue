<script setup lang="ts">
import { areaY } from '@tanstack/charts/area'
import { barY } from '@tanstack/charts/bar'
import { d3Curve } from '@tanstack/charts/d3/shape'
import { group } from '@tanstack/charts/group'
import { lineY } from '@tanstack/charts/line'
import { decorative } from '@tanstack/charts/mark/decorative'
import { scaleBand } from '@tanstack/charts/scales/band'
import { scaleLinear } from '@tanstack/charts/scales/linear'
import { defineChart } from '@tanstack/charts/scene'
import { tooltip } from '@tanstack/charts/tooltip'
import type { ChartPoint } from '@tanstack/charts/types'
import { Chart } from '@tanstack/charts/vue'
import { curveMonotoneX } from 'd3-shape'
import { computed, ref } from 'vue'

import {
    createChartTooltipModel,
    createDataNotices,
    createSeriesModel,
    formatAxisTime,
    formatDataNotice,
    formatMetricValue,
    formatNumber,
    formatSeriesPointTime,
    type ChartTooltipModel,
    type MetricSeriesPoint,
    type SeriesValue,
} from '../../../../ui-core/index.ts'
import {
    resolveInsightUIClass,
    type InsightChartProps,
    type InsightChartSlots,
    type InsightChartUI,
} from '../types.ts'

defineOptions({ inheritAttrs: false })

interface BarDatum extends SeriesValue {
    color: string
    metric: string
}

type RendererPoint = ChartPoint<SeriesValue | BarDatum, number, number>

const props = withDefaults(defineProps<InsightChartProps>(), {
    height: 360,
    locale: 'en-US',
    smooth: false,
    type: 'line',
})

defineSlots<InsightChartSlots>()

const ui = computed<Required<InsightChartUI>>(() => ({
    empty: resolveInsightUIClass('insight-empty-state', props.ui?.empty),
    header: resolveInsightUIClass('insight-chart__header', props.ui?.header),
    legend: resolveInsightUIClass('insight-chart__legend', props.ui?.legend),
    legendIndicator: resolveInsightUIClass(
        'insight-chart__legend-indicator',
        props.ui?.legendIndicator,
    ),
    legendItem: resolveInsightUIClass('insight-chart__legend-item', props.ui?.legendItem),
    notices: resolveInsightUIClass('insight-notices', props.ui?.notices),
    plot: resolveInsightUIClass('insight-chart__plot', props.ui?.plot),
    root: resolveInsightUIClass('insight-chart', props.ui?.root),
    title: resolveInsightUIClass('insight-chart__title', props.ui?.title),
    tooltip: resolveInsightUIClass('insight-chart__tooltip', props.ui?.tooltip),
    tooltipItem: resolveInsightUIClass('insight-chart__tooltip-item', props.ui?.tooltipItem),
    tooltipLabel: resolveInsightUIClass('insight-chart__tooltip-label', props.ui?.tooltipLabel),
}))
const chartColors = [
    'var(--insight-chart-1)',
    'var(--insight-chart-2)',
    'var(--insight-chart-3)',
    'var(--insight-chart-4)',
    'var(--insight-chart-5)',
    'var(--insight-chart-6)',
]
const model = computed(() =>
    createSeriesModel(props.data, {
        colors: props.colors ?? chartColors,
        includeZero: props.type === 'bar',
        maxPoints: 500,
        ...(props.yAxis ? { yAxis: props.yAxis } : {}),
    }),
)
const barValues = computed(() => {
    const values: BarDatum[] = []
    for (const series of model.value.series) {
        for (const value of series.values) {
            values.push({
                color: series.color,
                index: value.index,
                metric: series.metric,
                time: value.time,
                value: value.value,
            })
        }
    }
    return values
})
const barTimes = computed(() =>
    [...new Set(barValues.value.map(({ time }) => time))].toSorted((left, right) => left - right),
)
const empty = computed(
    () =>
        model.value.points.length === 0 ||
        model.value.series.length === 0 ||
        model.value.series.every(({ values }) => values.length === 0),
)
const label = computed(() => props.title ?? `Insight ${props.type} chart`)
const notices = computed(() => createDataNotices(props.data.meta.quality))
const messages = computed(() => notices.value.map(formatDataNotice))
const areaBaseline = computed(() => {
    const { max, min } = model.value.yDomain
    return min <= 0 && max >= 0 ? 0 : min > 0 ? min : max
})
const curve = computed(() => (props.smooth ? d3Curve(curveMonotoneX) : undefined))
const definition = computed(() => {
    const marks =
        props.type === 'bar'
            ? [
                  barY(barValues.value, {
                      fill: (datum) => datum.color,
                      id: 'bars',
                      inset: 1,
                      key: (datum) => `${datum.metric}:${datum.index}`,
                      layout: group(),
                      x: 'time',
                      y: 'value',
                      z: 'metric',
                  }),
              ]
            : model.value.series.flatMap((series) => {
                  const line = lineY(series.values, {
                      ...(curve.value ? { curve: curve.value } : {}),
                      id: `line-${series.metric}`,
                      stroke: series.color,
                      strokeWidth: 2.25,
                      x: 'time',
                      y: 'value',
                  })
                  if (props.type === 'line') return [line]
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
    const { timeDomain, yDomain } = model.value
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
                            formatAxisTime(value, props.locale, props.timezone, props.xAxis),
                        size: 0,
                    },
                },
                scale:
                    props.type === 'bar'
                        ? () =>
                              scaleBand<number>()
                                  .domain(barTimes.value)
                                  .paddingInner(0.12)
                                  .paddingOuter(0.06)
                        : () => scaleLinear().domain(timeDomain),
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
            className: 'insight-chart-tooltip-host',
            placement: ['top', 'right', 'left', 'bottom'],
            use: tooltip,
        },
    })
})
const showExactData = ref(false)
const largeExactData = computed(() => model.value.points.length * model.value.series.length > 1_000)
const showDataTable = computed(() => !largeExactData.value || showExactData.value)

function tooltipForPoints(points: readonly RendererPoint[]): ChartTooltipModel | undefined {
    const index = points[0]?.datum.index
    return index === undefined
        ? undefined
        : createChartTooltipModel(
              model.value,
              index,
              props.locale,
              props.timezone,
              props.xAxis,
              props.yAxis,
          )
}

function formatPointTime(point: MetricSeriesPoint): string {
    return formatSeriesPointTime(point, props.locale, props.timezone, props.xAxis)
}

function formatPointValue(point: MetricSeriesPoint, metric: string): string {
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
        :data-chart-type="props.type"
        :data-slot="String($attrs['data-slot'] ?? 'root')"
    >
        <header v-if="props.title || !empty" :class="ui.header" data-slot="header">
            <slot v-if="props.title" name="title" :title="props.title">
                <h3 :class="ui.title" data-slot="title">{{ props.title }}</h3>
            </slot>

            <slot v-if="!empty" name="legend" :series="model.series">
                <ul :class="ui.legend" data-slot="legend">
                    <li
                        v-for="series in model.series"
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
                class="insight-chart__renderer"
                class-name="insight-chart__svg"
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

        <button
            v-if="!empty && largeExactData"
            :aria-expanded="showExactData"
            class="insight-chart__data-toggle"
            data-slot="data-toggle"
            type="button"
            @click="showExactData = !showExactData"
        >
            {{ showExactData ? 'Hide' : 'Show' }} exact data ({{ model.points.length }} rows)
        </button>

        <table v-if="!empty && showDataTable" class="insight-chart__data insight-sr-only">
            <caption>
                {{
                    label
                }}
                data
            </caption>
            <thead>
                <tr>
                    <th scope="col">Time</th>
                    <th v-for="series in model.series" :key="series.metric" scope="col">
                        {{ series.name }}
                    </th>
                </tr>
            </thead>
            <tbody>
                <tr v-for="point in model.points" :key="point.key">
                    <th scope="row">{{ formatPointTime(point) }}</th>
                    <td v-for="series in model.series" :key="series.metric">
                        {{ formatPointValue(point, series.metric) }}
                    </td>
                </tr>
            </tbody>
        </table>

        <slot
            v-if="messages.length > 0"
            name="notices"
            :messages
            :notices
            :quality="props.data.meta.quality"
        >
            <p aria-live="polite" :class="ui.notices" data-slot="notices" role="status">
                {{ messages.join(' \u00b7 ') }}
            </p>
        </slot>
    </section>
</template>
