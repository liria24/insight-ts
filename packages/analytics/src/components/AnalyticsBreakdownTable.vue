<script setup lang="ts">
import { computed } from 'vue'

import type { AnalyticsReportQuality, AnalyticsTableRow } from '../core/types'
import {
    formatMetricName,
    formatTableCell,
    qualityMessages,
    resolveTableFields,
    tableCellValue,
} from '../presentation'
import {
    resolveAnalyticsUIClass,
    type AnalyticsBreakdownTableProps,
    type AnalyticsBreakdownTableUI,
} from '../vue-ui'

defineOptions({ inheritAttrs: false })

const props = withDefaults(defineProps<AnalyticsBreakdownTableProps>(), {
    emptyText: 'No data',
    locale: 'en-US',
    maximumFractionDigits: 2,
})

defineSlots<{
    cell(properties: {
        column: string
        formatted: string
        kind: 'dimension' | 'metric'
        rowIndex: number
        value: boolean | number | string | null
    }): unknown
    empty(properties: { message: string }): unknown
    header(properties: { column: string }): unknown
    quality(properties: { messages: readonly string[]; quality: AnalyticsReportQuality }): unknown
}>()

const ui = computed<Required<AnalyticsBreakdownTableUI>>(() => ({
    body: resolveAnalyticsUIClass('analytics-breakdown-table__body', props.ui?.body),
    cell: resolveAnalyticsUIClass('analytics-breakdown-table__cell', props.ui?.cell),
    empty: resolveAnalyticsUIClass('analytics-empty-state', props.ui?.empty),
    header: resolveAnalyticsUIClass('analytics-breakdown-table__header', props.ui?.header),
    headerCell: resolveAnalyticsUIClass(
        'analytics-breakdown-table__header-cell',
        props.ui?.headerCell,
    ),
    quality: resolveAnalyticsUIClass('analytics-quality', props.ui?.quality),
    root: resolveAnalyticsUIClass('analytics-breakdown-table', props.ui?.root),
    row: resolveAnalyticsUIClass('analytics-breakdown-table__row', props.ui?.row),
    table: resolveAnalyticsUIClass('analytics-breakdown-table__table', props.ui?.table),
}))
const dimensions = computed(() => resolveTableFields(props.report, props.dimensions, 'dimensions'))
const metrics = computed(() => resolveTableFields(props.report, props.metrics, 'metrics'))
const headers = computed(() => [...dimensions.value, ...metrics.value])
const messages = computed(() => qualityMessages(props.report.meta.quality))
const isEmpty = computed(
    () => props.report.rows.length === 0 || dimensions.value.length + metrics.value.length === 0,
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
        <slot v-if="isEmpty" name="empty" :message="props.emptyText">
            <div aria-live="polite" :class="ui.empty" data-slot="empty" role="status">
                <strong>Analytics breakdown</strong>
                <span>{{ props.emptyText }}</span>
            </div>
        </slot>

        <template v-else>
            <table :class="ui.table" data-slot="table">
                <thead :class="ui.header" data-slot="header">
                    <tr :class="ui.row" data-slot="row">
                        <th
                            v-for="column in headers"
                            :key="column"
                            :class="ui.headerCell"
                            data-slot="header-cell"
                            scope="col"
                        >
                            <slot name="header" :column>
                                {{ formatMetricName(column) }}
                            </slot>
                        </th>
                    </tr>
                </thead>
                <tbody :class="ui.body" data-slot="body">
                    <tr
                        v-for="(row, rowIndex) in props.report.rows"
                        :key="rowIndex"
                        :class="ui.row"
                        data-slot="row"
                    >
                        <td
                            v-for="column in dimensions"
                            :key="`dimension:${column}`"
                            :class="ui.cell"
                            data-slot="cell"
                        >
                            <slot
                                name="cell"
                                :column
                                :formatted="formattedValue(row, column, 'dimension')"
                                kind="dimension"
                                :row-index="rowIndex"
                                :value="valueFor(row, column, 'dimension')"
                            >
                                {{ formattedValue(row, column, 'dimension') }}
                            </slot>
                        </td>
                        <td
                            v-for="column in metrics"
                            :key="`metric:${column}`"
                            :class="ui.cell"
                            data-slot="cell"
                        >
                            <slot
                                name="cell"
                                :column
                                :formatted="formattedValue(row, column, 'metric')"
                                kind="metric"
                                :row-index="rowIndex"
                                :value="valueFor(row, column, 'metric')"
                            >
                                {{ formattedValue(row, column, 'metric') }}
                            </slot>
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
        </template>
    </section>
</template>
