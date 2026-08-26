import {
    computed,
    defineAsyncComponent,
    defineComponent,
    h,
    onMounted,
    ref,
    type PropType,
    type VNodeChild,
} from 'vue'
import type { VueUiXyConfig, VueUiXyDatasetItem } from 'vue-data-ui'

import type {
    AnalyticsDimensionValues,
    AnalyticsMetricValues,
    AnalyticsReport,
    AnalyticsReportQuality,
    AnalyticsSeriesPoint,
} from './core/types'

export interface AnalyticsStatProps {
    emptyText?: string
    label?: string
    locale?: string
    maximumFractionDigits?: number
    metric: string
    report: AnalyticsReport
}

export interface AnalyticsLineChartProps {
    colors?: readonly string[]
    height?: number
    metrics?: readonly string[]
    report: AnalyticsReport
    smooth?: boolean
    title?: string
}

export interface AnalyticsBreakdownTableProps {
    dimensions?: readonly string[]
    emptyText?: string
    locale?: string
    maximumFractionDigits?: number
    metrics?: readonly string[]
    report: AnalyticsReport
}

export interface AnalyticsChartSeries {
    color?: string
    metric: string
    name: string
    values: readonly (number | null)[]
}

const defaultChartColors = ['#6376DD', '#43A047', '#FB8C00', '#8E24AA', '#00838F', '#D81B60']

const ClientVueUiXy =
    typeof window === 'undefined'
        ? undefined
        : defineAsyncComponent(() => import('vue-data-ui/vue-ui-xy').then(({ VueUiXy }) => VueUiXy))

export const AnalyticsStat = defineComponent({
    name: 'AnalyticsStat',
    props: {
        emptyText: { type: String, default: 'No data' },
        label: { type: String, default: undefined },
        locale: { type: String, default: 'en-US' },
        maximumFractionDigits: { type: Number, default: 2 },
        metric: { type: String, required: true },
        report: { type: Object as PropType<AnalyticsReport>, required: true },
    },
    setup(props, { slots }) {
        const selection = computed(() => selectStatValue(props.report, props.metric))
        const label = computed(() => props.label ?? formatMetricName(props.metric))

        return () => {
            const selected = selection.value
            if (!selected || selected.value === null || !Number.isFinite(selected.value)) {
                return renderEmpty(
                    label.value,
                    props.emptyText,
                    slots.empty?.({ metric: props.metric }),
                )
            }

            const formatted = formatNumber(
                selected.value,
                props.locale,
                props.maximumFractionDigits,
            )
            return h(
                'section',
                { 'aria-label': label.value, class: 'analytics-stat' },
                compactChildren([
                    slots.label?.({ label: label.value, metric: props.metric }) ??
                        h('p', { class: 'analytics-stat__label' }, label.value),
                    slots.value?.({
                        formatted,
                        metric: props.metric,
                        point: selected.point,
                        value: selected.value,
                    }) ?? h('p', { class: 'analytics-stat__value' }, formatted),
                    selected.point
                        ? (slots.caption?.({ point: selected.point }) ??
                          h(
                              'p',
                              { class: 'analytics-stat__caption' },
                              `As of ${selected.point.time.slice(0, 10)}`,
                          ))
                        : undefined,
                    renderQuality(props.report.meta.quality, slots.quality),
                ]),
            )
        }
    },
})

export const AnalyticsLineChart = defineComponent({
    name: 'AnalyticsLineChart',
    props: {
        colors: { type: Array as PropType<readonly string[]>, default: undefined },
        height: { type: Number, default: 360 },
        metrics: { type: Array as PropType<readonly string[]>, default: undefined },
        report: { type: Object as PropType<AnalyticsReport>, required: true },
        smooth: { type: Boolean, default: false },
        title: { type: String, default: undefined },
    },
    setup(props, { slots }) {
        const mounted = ref(false)
        onMounted(() => {
            mounted.value = true
        })

        const selectedMetrics = computed(() => resolveSeriesMetrics(props.report, props.metrics))
        const chartSeries = computed<AnalyticsChartSeries[]>(() => {
            const report = props.report
            if (report.kind !== 'series') return []
            const colors = props.colors ?? defaultChartColors
            return selectedMetrics.value.map((metric, index) => ({
                ...(colors.length > 0 ? { color: colors[index % colors.length] } : {}),
                metric,
                name: formatMetricName(metric),
                values: report.points.map((point) => finiteMetric(point.values[metric])),
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
            line: { smooth: props.smooth, useGradient: false },
            responsive: true,
        }))

        return () => {
            const label = props.title ?? 'Analytics line chart'
            if (props.report.kind !== 'series') {
                return renderEmpty(label, 'No time series data', slots.empty?.({ reason: 'kind' }))
            }
            if (props.report.points.length === 0 || selectedMetrics.value.length === 0) {
                return renderEmpty(label, 'No data', slots.empty?.({ reason: 'empty' }))
            }

            const transformed = {
                metrics: selectedMetrics.value,
                points: props.report.points,
                series: chartSeries.value,
                times: props.report.points.map((point) => point.time),
            }
            const chart =
                slots.chart?.(transformed) ??
                (mounted.value && ClientVueUiXy
                    ? h(ClientVueUiXy, { config: config.value, dataset: dataset.value })
                    : renderSeriesFallback(props.report.points, selectedMetrics.value))

            return h(
                'section',
                { 'aria-label': label, class: 'analytics-line-chart' },
                compactChildren([
                    props.title
                        ? (slots.title?.({ title: props.title }) ??
                          h('h3', { class: 'analytics-line-chart__title' }, props.title))
                        : undefined,
                    h(
                        'div',
                        {
                            class: 'analytics-line-chart__canvas',
                            style: { minHeight: `${props.height}px` },
                        },
                        chart,
                    ),
                    renderQuality(props.report.meta.quality, slots.quality),
                ]),
            )
        }
    },
})

export const AnalyticsBreakdownTable = defineComponent({
    name: 'AnalyticsBreakdownTable',
    props: {
        dimensions: { type: Array as PropType<readonly string[]>, default: undefined },
        emptyText: { type: String, default: 'No data' },
        locale: { type: String, default: 'en-US' },
        maximumFractionDigits: { type: Number, default: 2 },
        metrics: { type: Array as PropType<readonly string[]>, default: undefined },
        report: { type: Object as PropType<AnalyticsReport>, required: true },
    },
    setup(props, { slots }) {
        const dimensions = computed(() =>
            resolveTableFields(props.report, props.dimensions, 'dimensions'),
        )
        const metrics = computed(() => resolveTableFields(props.report, props.metrics, 'metrics'))

        return () => {
            if (props.report.kind !== 'table') {
                return renderEmpty(
                    'Analytics breakdown',
                    'No breakdown data',
                    slots.empty?.({ reason: 'kind' }),
                )
            }
            if (
                props.report.rows.length === 0 ||
                dimensions.value.length + metrics.value.length === 0
            ) {
                return renderEmpty(
                    'Analytics breakdown',
                    props.emptyText,
                    slots.empty?.({ reason: 'empty' }),
                )
            }

            const headers = [...dimensions.value, ...metrics.value]
            const table = h('table', { class: 'analytics-breakdown-table__table' }, [
                h(
                    'thead',
                    h(
                        'tr',
                        headers.map((column) =>
                            h(
                                'th',
                                { key: column, scope: 'col' },
                                slots.header?.({ column }) ?? formatMetricName(column),
                            ),
                        ),
                    ),
                ),
                h(
                    'tbody',
                    props.report.rows.map((row, rowIndex) =>
                        h('tr', { key: rowIndex }, [
                            ...dimensions.value.map((column) =>
                                renderTableCell(
                                    column,
                                    row.dimensions,
                                    rowIndex,
                                    'dimension',
                                    props,
                                    slots.cell,
                                ),
                            ),
                            ...metrics.value.map((column) =>
                                renderTableCell(
                                    column,
                                    row.metrics,
                                    rowIndex,
                                    'metric',
                                    props,
                                    slots.cell,
                                ),
                            ),
                        ]),
                    ),
                ),
            ])

            return h(
                'section',
                { 'aria-label': 'Analytics breakdown', class: 'analytics-breakdown-table' },
                compactChildren([
                    slots.table?.({
                        dimensions: dimensions.value,
                        metrics: metrics.value,
                        rows: props.report.rows,
                    }) ?? table,
                    renderQuality(props.report.meta.quality, slots.quality),
                ]),
            )
        }
    },
})

function selectStatValue(
    report: AnalyticsReport,
    metric: string,
): { point?: AnalyticsSeriesPoint; value: number | null } | undefined {
    if (report.kind === 'scalar') {
        return Object.hasOwn(report.values, metric)
            ? { value: finiteMetric(report.values[metric]) }
            : undefined
    }
    if (report.kind !== 'series') return undefined
    const point = [...report.points]
        .filter((candidate) => Object.hasOwn(candidate.values, metric))
        .reduce<AnalyticsSeriesPoint | undefined>(
            (latest, candidate) => (!latest || candidate.time > latest.time ? candidate : latest),
            undefined,
        )
    return point ? { point, value: finiteMetric(point.values[metric]) } : undefined
}

function resolveSeriesMetrics(
    report: AnalyticsReport,
    requested: readonly string[] | undefined,
): string[] {
    if (report.kind !== 'series') return []
    const available = new Set(
        report.points.flatMap((point) =>
            Object.entries(point.values).flatMap(([metric, value]) =>
                finiteMetric(value) === null ? [] : [metric],
            ),
        ),
    )
    return unique(requested?.length ? requested : [...available]).filter((metric) =>
        available.has(metric),
    )
}

function resolveTableFields(
    report: AnalyticsReport,
    requested: readonly string[] | undefined,
    field: 'dimensions' | 'metrics',
): string[] {
    if (report.kind !== 'table') return []
    const available = new Set(report.rows.flatMap((row) => Object.keys(row[field])))
    return unique(requested?.length ? requested : [...available]).filter((name) =>
        available.has(name),
    )
}

function renderTableCell(
    column: string,
    values: AnalyticsDimensionValues | AnalyticsMetricValues,
    rowIndex: number,
    kind: 'dimension' | 'metric',
    props: { locale: string; maximumFractionDigits: number },
    slot: ((properties: Record<string, unknown>) => VNodeChild) | undefined,
) {
    const value = values[column] ?? null
    const formatted =
        typeof value === 'number' && Number.isFinite(value)
            ? formatNumber(value, props.locale, props.maximumFractionDigits)
            : value === null
              ? '—'
              : String(value)
    return h(
        'td',
        { key: `${kind}:${column}` },
        slot?.({ column, formatted, kind, rowIndex, value }) ?? formatted,
    )
}

function renderSeriesFallback(points: readonly AnalyticsSeriesPoint[], metrics: readonly string[]) {
    return h(
        'ol',
        { class: 'analytics-line-chart__fallback' },
        points.map((point) =>
            h(
                'li',
                { key: `${point.time}:${JSON.stringify(point.dimensions ?? {})}` },
                `${point.time}: ${metrics
                    .map(
                        (metric) =>
                            `${formatMetricName(metric)}: ${formatMetricValue(point.values[metric])}`,
                    )
                    .join(', ')}`,
            ),
        ),
    )
}

function renderQuality(
    quality: AnalyticsReportQuality,
    slot: ((properties: Record<string, unknown>) => VNodeChild) | undefined,
): VNodeChild | undefined {
    const messages = [
        ...(quality.partial ? ['Partial data'] : []),
        ...(quality.approximate ? ['Approximate data'] : []),
        ...(quality.sampled ? ['Sampled data'] : []),
        ...(quality.thresholded ? ['Thresholded data'] : []),
        ...(quality.warnings ?? []).map((warning) => warning.message),
    ]
    if (messages.length === 0) return undefined
    return (
        slot?.({ messages, quality }) ??
        h(
            'p',
            { 'aria-live': 'polite', class: 'analytics-quality', role: 'status' },
            messages.join(' · '),
        )
    )
}

function renderEmpty(label: string, message: string, slot: VNodeChild | undefined) {
    if (slot) return slot
    return h(
        'div',
        {
            'aria-label': label,
            'aria-live': 'polite',
            class: 'analytics-empty-state',
            role: 'status',
        },
        [h('strong', label), h('span', message)],
    )
}

function compactChildren(children: readonly (VNodeChild | undefined)[]): VNodeChild[] {
    return children.filter((child): child is VNodeChild => child !== undefined && child !== null)
}

function finiteMetric(value: number | null | undefined): number | null {
    return typeof value === 'number' && Number.isFinite(value) ? value : null
}

function formatMetricName(metric: string): string {
    return metric
        .replace(/([a-z\d])([A-Z])/g, '$1 $2')
        .replace(/[_-]+/g, ' ')
        .replace(/^./, (character) => character.toUpperCase())
}

function formatMetricValue(value: number | null | undefined): string {
    const metric = finiteMetric(value)
    return metric === null ? 'No data' : formatNumber(metric, 'en-US', 2)
}

function formatNumber(value: number, locale: string, maximumFractionDigits: number): string {
    return new Intl.NumberFormat(locale, { maximumFractionDigits }).format(value)
}

function unique(values: readonly string[]): string[] {
    return [...new Set(values)]
}
