<script setup lang="ts">
import { computed } from 'vue'

import type { AnalyticsReportQuality, AnalyticsTableReport, AnalyticsTableRow } from '../core/types'
import {
    formatMetricName,
    formatTableCell,
    qualityMessages,
    resolveAnalyticsUIClass,
    resolveTableFields,
    tableCellValue,
    type AnalyticsBreakdownTableProps,
    type AnalyticsBreakdownTableUI,
} from '../vue-ui'

defineOptions({ inheritAttrs: false })

const props = withDefaults(defineProps<AnalyticsBreakdownTableProps>(), {
    emptyText: 'No data',
    locale: 'en-US',
    maximumFractionDigits: 2,
})

type ResolvedUI = Readonly<Required<AnalyticsBreakdownTableUI>>

defineSlots<{
    cell(properties: {
        column: string
        formatted: string
        kind: 'dimension' | 'metric'
        rowIndex: number
        ui: ResolvedUI
        value: boolean | number | string | null
    }): unknown
    empty(properties: { reason: 'empty' | 'kind'; ui: ResolvedUI }): unknown
    header(properties: { column: string; ui: ResolvedUI }): unknown
    quality(properties: {
        messages: readonly string[]
        quality: AnalyticsReportQuality
        ui: ResolvedUI
    }): unknown
    table(properties: {
        dimensions: readonly string[]
        metrics: readonly string[]
        rows: readonly AnalyticsTableRow[]
        ui: ResolvedUI
    }): unknown
}>()

const ui = computed<ResolvedUI>(() => ({
    base: resolveAnalyticsUIClass('analytics-breakdown-table__table', props.ui?.base),
    empty: resolveAnalyticsUIClass('analytics-empty-state', props.ui?.empty),
    quality: resolveAnalyticsUIClass('analytics-quality', props.ui?.quality),
    root: resolveAnalyticsUIClass('analytics-breakdown-table', props.ui?.root),
    tbody: resolveAnalyticsUIClass('analytics-breakdown-table__tbody', props.ui?.tbody),
    td: resolveAnalyticsUIClass('analytics-breakdown-table__td', props.ui?.td),
    th: resolveAnalyticsUIClass('analytics-breakdown-table__th', props.ui?.th),
    thead: resolveAnalyticsUIClass('analytics-breakdown-table__thead', props.ui?.thead),
    tr: resolveAnalyticsUIClass('analytics-breakdown-table__tr', props.ui?.tr),
}))
const tableReport = computed<AnalyticsTableReport | undefined>(() =>
    props.report.kind === 'table' ? props.report : undefined,
)
const dimensions = computed(() => resolveTableFields(props.report, props.dimensions, 'dimensions'))
const metrics = computed(() => resolveTableFields(props.report, props.metrics, 'metrics'))
const headers = computed(() => [...dimensions.value, ...metrics.value])
const messages = computed(() => qualityMessages(props.report.meta.quality))
const isEmpty = computed(
    () =>
        tableReport.value !== undefined &&
        (tableReport.value.rows.length === 0 ||
            dimensions.value.length + metrics.value.length === 0),
)

function valueFor(
    row: AnalyticsTableRow,
    column: string,
    kind: 'dimension' | 'metric',
): boolean | number | string | null {
    return tableCellValue(column, kind === 'dimension' ? row.dimensions : row.metrics)
}

function formattedValue(
    row: AnalyticsTableRow,
    column: string,
    kind: 'dimension' | 'metric',
): string {
    return formatTableCell(valueFor(row, column, kind), props.locale, props.maximumFractionDigits)
}
</script>

<template>
    <section
        v-bind="$attrs"
        :aria-label="String($attrs['aria-label'] ?? 'Analytics breakdown')"
        :class="[ui.root, props.class]"
        :data-slot="String($attrs['data-slot'] ?? 'root')"
    >
        <slot v-if="!tableReport" name="empty" reason="kind" :ui="ui">
            <div aria-live="polite" :class="ui.empty" data-slot="empty" role="status">
                <strong>Analytics breakdown</strong>
                <span>No breakdown data</span>
            </div>
        </slot>

        <slot v-else-if="isEmpty" name="empty" reason="empty" :ui="ui">
            <div aria-live="polite" :class="ui.empty" data-slot="empty" role="status">
                <strong>Analytics breakdown</strong>
                <span>{{ props.emptyText }}</span>
            </div>
        </slot>

        <template v-else>
            <slot
                name="table"
                :dimensions="dimensions"
                :metrics="metrics"
                :rows="tableReport.rows"
                :ui="ui"
            >
                <table :class="ui.base" data-slot="base">
                    <thead :class="ui.thead" data-slot="thead">
                        <tr :class="ui.tr" data-slot="tr">
                            <th
                                v-for="column in headers"
                                :key="column"
                                :class="ui.th"
                                data-slot="th"
                                scope="col"
                            >
                                <slot name="header" :column="column" :ui="ui">
                                    {{ formatMetricName(column) }}
                                </slot>
                            </th>
                        </tr>
                    </thead>
                    <tbody :class="ui.tbody" data-slot="tbody">
                        <tr
                            v-for="(row, rowIndex) in tableReport.rows"
                            :key="rowIndex"
                            :class="ui.tr"
                            data-slot="tr"
                        >
                            <td
                                v-for="column in dimensions"
                                :key="`dimension:${column}`"
                                :class="ui.td"
                                data-slot="td"
                            >
                                <slot
                                    name="cell"
                                    :column="column"
                                    :formatted="formattedValue(row, column, 'dimension')"
                                    kind="dimension"
                                    :row-index="rowIndex"
                                    :ui="ui"
                                    :value="valueFor(row, column, 'dimension')"
                                >
                                    {{ formattedValue(row, column, 'dimension') }}
                                </slot>
                            </td>
                            <td
                                v-for="column in metrics"
                                :key="`metric:${column}`"
                                :class="ui.td"
                                data-slot="td"
                            >
                                <slot
                                    name="cell"
                                    :column="column"
                                    :formatted="formattedValue(row, column, 'metric')"
                                    kind="metric"
                                    :row-index="rowIndex"
                                    :ui="ui"
                                    :value="valueFor(row, column, 'metric')"
                                >
                                    {{ formattedValue(row, column, 'metric') }}
                                </slot>
                            </td>
                        </tr>
                    </tbody>
                </table>
            </slot>

            <slot
                v-if="messages.length > 0"
                name="quality"
                :messages="messages"
                :quality="props.report.meta.quality"
                :ui="ui"
            >
                <p aria-live="polite" :class="ui.quality" data-slot="quality" role="status">
                    {{ messages.join(' \u00b7 ') }}
                </p>
            </slot>
        </template>
    </section>
</template>
