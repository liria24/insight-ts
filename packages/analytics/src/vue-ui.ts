import {
    computed,
    defineAsyncComponent,
    defineComponent,
    h,
    onMounted,
    ref,
    type PropType,
} from 'vue'
import type { VueUiXyConfig, VueUiXyDatasetItem } from 'vue-data-ui'

import type { AnalyticsSeriesReport } from './core/types'

export interface AnalyticsKpiCardProps {
    label: string
    value: number | null
    caption?: string
}

export interface AnalyticsSeriesChartProps {
    report: AnalyticsSeriesReport
    metrics?: readonly string[]
    title?: string
    height?: number
}

export interface AnalyticsDashboardProps {
    report: AnalyticsSeriesReport
    title?: string
    metrics?: readonly string[]
}

const kpiConfig = {
    backgroundColor: 'transparent',
    titleBold: true,
    titleFontSize: 13,
    useAnimation: true,
    valueBold: true,
    valueFontSize: 30,
    valueRounding: 0,
}

const chartColors = ['#6376DD', '#43A047', '#FB8C00', '#8E24AA', '#00838F', '#D81B60']

const ClientVueUiKpi =
    typeof window === 'undefined'
        ? undefined
        : defineAsyncComponent(() =>
              import('vue-data-ui/vue-ui-kpi').then(({ VueUiKpi }) => VueUiKpi),
          )
const ClientVueUiXy =
    typeof window === 'undefined'
        ? undefined
        : defineAsyncComponent(() => import('vue-data-ui/vue-ui-xy').then(({ VueUiXy }) => VueUiXy))

export const AnalyticsKpiCard = defineComponent({
    name: 'AnalyticsKpiCard',
    props: {
        caption: { type: String, default: undefined },
        label: { type: String, required: true },
        value: { type: Number as PropType<number | null>, default: null },
    },
    setup(props) {
        const mounted = ref(false)
        onMounted(() => {
            mounted.value = true
        })

        return () => {
            if (props.value === null || !Number.isFinite(props.value)) {
                return emptyState(props.label, 'No data', props.caption)
            }

            const useVueDataUi = mounted.value && ClientVueUiKpi
            const kpi = useVueDataUi
                ? h(ClientVueUiKpi, {
                      config: { ...kpiConfig, title: props.label },
                      dataset: props.value,
                  })
                : h('p', { class: 'analytics-kpi-card__value' }, formatValue(props.value))

            return h('div', { 'aria-label': props.label, class: 'analytics-kpi-card' }, [
                ...(useVueDataUi
                    ? [kpi]
                    : [h('p', { class: 'analytics-kpi-card__label' }, props.label), kpi]),
                props.caption
                    ? h('p', { class: 'analytics-kpi-card__caption' }, props.caption)
                    : null,
            ])
        }
    },
})

export const AnalyticsSeriesChart = defineComponent({
    name: 'AnalyticsSeriesChart',
    props: {
        height: { type: Number, default: 360 },
        metrics: {
            type: Array as PropType<readonly string[]>,
            default: undefined,
        },
        report: { type: Object as PropType<AnalyticsSeriesReport>, required: true },
        title: { type: String, default: undefined },
    },
    setup(props) {
        const mounted = ref(false)
        onMounted(() => {
            mounted.value = true
        })

        const selectedMetrics = computed(() => resolveMetrics(props.report, props.metrics))
        const dataset = computed<VueUiXyDatasetItem[]>(() => {
            if (props.report.kind !== 'series') return []

            return selectedMetrics.value.map((metric, index) => ({
                color: chartColors[index % chartColors.length]!,
                name: formatMetricName(metric),
                series: props.report.points.map((point) => {
                    const value = point.values[metric]
                    return typeof value === 'number' && Number.isFinite(value) ? value : null
                }),
                type: 'line',
            }))
        })
        const config = computed<VueUiXyConfig>(() => ({
            chart: {
                grid: {
                    labels: {
                        xAxisLabels: {
                            values:
                                props.report.kind === 'series'
                                    ? props.report.points.map((point) => point.time)
                                    : [],
                        },
                    },
                },
                height: props.height,
                title: { show: false },
                userOptions: { show: false },
            },
            line: { smooth: true, useGradient: false },
            responsive: true,
            theme: 'minimal',
        }))

        return () => {
            if (props.report.kind !== 'series')
                return emptyState('Series chart', 'No time series data')
            if (props.report.points.length === 0 || selectedMetrics.value.length === 0) {
                return emptyState(props.title ?? 'Series chart', 'No data')
            }

            const chart =
                mounted.value && ClientVueUiXy
                    ? h(ClientVueUiXy, { config: config.value, dataset: dataset.value })
                    : h(
                          'ol',
                          { class: 'analytics-series-chart__fallback' },
                          props.report.points.map((point) =>
                              h(
                                  'li',
                                  `${point.time}: ${formatPoint(point, selectedMetrics.value)}`,
                              ),
                          ),
                      )

            return h(
                'section',
                {
                    'aria-label': props.title ?? 'Analytics series',
                    class: 'analytics-series-chart',
                },
                [
                    props.title
                        ? h('h3', { class: 'analytics-series-chart__title' }, props.title)
                        : null,
                    h(
                        'div',
                        {
                            class: 'analytics-series-chart__canvas',
                            style: { minHeight: `${props.height}px` },
                        },
                        [chart],
                    ),
                ],
            )
        }
    },
})

export const AnalyticsDashboard = defineComponent({
    name: 'AnalyticsDashboard',
    props: {
        metrics: {
            type: Array as PropType<readonly string[]>,
            default: undefined,
        },
        report: { type: Object as PropType<AnalyticsSeriesReport>, required: true },
        title: { type: String, default: 'Analytics' },
    },
    setup(props) {
        const selectedMetrics = computed(() => resolveMetrics(props.report, props.metrics))
        const latestPoint = computed(() => {
            if (props.report.kind !== 'series' || props.report.points.length === 0) return undefined
            return props.report.points.reduce(
                (latest, point) =>
                    latest === undefined || point.time > latest.time ? point : latest,
                undefined as AnalyticsSeriesReport['points'][number] | undefined,
            )
        })
        const qualityMessages = computed(() => {
            const quality = props.report.meta?.quality
            if (!quality) return []

            return [
                ...(quality.partial ? ['Partial data'] : []),
                ...(quality.approximate ? ['Approximate data'] : []),
                ...(quality.warnings ?? []).map((warning) => warning.message),
            ]
        })

        return () => {
            const cards = selectedMetrics.value.map((metric) =>
                h(AnalyticsKpiCard, {
                    key: metric,
                    label: formatMetricName(metric),
                    value: latestPoint.value?.values[metric] ?? null,
                    ...(latestPoint.value
                        ? { caption: `As of ${latestPoint.value.time.slice(0, 10)}` }
                        : {}),
                }),
            )

            return h(
                'section',
                {
                    'aria-label': props.title,
                    class: 'analytics-dashboard',
                },
                [
                    h('h2', { class: 'analytics-dashboard__title' }, props.title),
                    qualityMessages.value.length > 0
                        ? h(
                              'div',
                              {
                                  'aria-live': 'polite',
                                  class: 'analytics-dashboard__quality',
                                  role: 'status',
                              },
                              qualityMessages.value.join(' · '),
                          )
                        : null,
                    cards.length > 0
                        ? h(
                              'div',
                              {
                                  class: 'analytics-dashboard__cards',
                                  style: {
                                      display: 'grid',
                                      gap: '1rem',
                                      gridTemplateColumns: 'repeat(auto-fit, minmax(180px, 1fr))',
                                  },
                              },
                              cards,
                          )
                        : null,
                    h(AnalyticsSeriesChart, {
                        metrics: selectedMetrics.value,
                        report: props.report,
                        title: 'Trend',
                    }),
                ],
            )
        }
    },
})

function emptyState(label: string, message: string, caption?: string) {
    return h(
        'div',
        {
            'aria-label': label,
            'aria-live': 'polite',
            class: 'analytics-empty-state',
            role: 'status',
        },
        [
            h('strong', label),
            h('span', message),
            caption ? h('p', { class: 'analytics-empty-state__caption' }, caption) : null,
        ],
    )
}

function resolveMetrics(
    report: AnalyticsSeriesReport,
    requested: readonly string[] | undefined,
): string[] {
    if (report.kind !== 'series') return []

    const available = new Map<string, boolean>()
    for (const point of report.points) {
        for (const [name, value] of Object.entries(point.values)) {
            const numeric = typeof value === 'number' && Number.isFinite(value)
            available.set(name, available.get(name) === true || numeric)
        }
    }

    const candidates = requested?.length
        ? requested
        : [...available].filter(([, numeric]) => numeric).map(([name]) => name)
    return [...new Set(candidates)].filter((metric) => available.has(metric))
}

function formatMetricName(metric: string): string {
    return metric
        .replace(/([a-z\d])([A-Z])/g, '$1 $2')
        .replace(/[_-]+/g, ' ')
        .replace(/^./, (character) => character.toUpperCase())
}

function formatPoint(
    point: AnalyticsSeriesReport['points'][number],
    metrics: readonly string[],
): string {
    return metrics
        .map((metric) => `${formatMetricName(metric)}: ${formatMetricValue(point.values[metric])}`)
        .join(', ')
}

function formatMetricValue(value: number | null | undefined): string {
    return typeof value === 'number' && Number.isFinite(value) ? formatValue(value) : 'No data'
}

function formatValue(value: number): string {
    return new Intl.NumberFormat('en-US', { maximumFractionDigits: 2 }).format(value)
}
