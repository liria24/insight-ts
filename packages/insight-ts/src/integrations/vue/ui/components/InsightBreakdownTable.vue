<script setup lang="ts">
import { computed } from 'vue'

import type { ReportQuality, TableRow } from '../../../../core/types.ts'
import {
    createBreakdownModel,
    createDataNotices,
    formatDataNotice,
    formatMetricName,
    formatTableCell,
    tableCellValue,
    type DataNotice,
} from '../../../../ui-core/index.ts'
import {
    resolveInsightUIClass,
    type InsightBreakdownTableProps,
    type InsightBreakdownTableUI,
} from '../types.ts'

defineOptions({ inheritAttrs: false })

const props = withDefaults(defineProps<InsightBreakdownTableProps>(), {
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
    notices(properties: {
        messages: readonly string[]
        notices: readonly DataNotice[]
        quality: ReportQuality
    }): unknown
}>()

const ui = computed<Required<InsightBreakdownTableUI>>(() => ({
    body: resolveInsightUIClass('insight-breakdown-table__body', props.ui?.body),
    cell: resolveInsightUIClass('insight-breakdown-table__cell', props.ui?.cell),
    empty: resolveInsightUIClass('insight-empty-state', props.ui?.empty),
    header: resolveInsightUIClass('insight-breakdown-table__header', props.ui?.header),
    headerCell: resolveInsightUIClass('insight-breakdown-table__header-cell', props.ui?.headerCell),
    notices: resolveInsightUIClass('insight-notices', props.ui?.notices),
    root: resolveInsightUIClass('insight-breakdown-table', props.ui?.root),
    row: resolveInsightUIClass('insight-breakdown-table__row', props.ui?.row),
    table: resolveInsightUIClass('insight-breakdown-table__table', props.ui?.table),
}))
const model = computed(() =>
    createBreakdownModel(props.report, {
        ...(props.dimensions ? { dimensions: props.dimensions } : {}),
        ...(props.metrics ? { metrics: props.metrics } : {}),
    }),
)
const dimensions = computed(() => model.value.dimensions)
const metrics = computed(() => model.value.metrics)
const headers = computed(() => [...dimensions.value, ...metrics.value])
const notices = computed(() => createDataNotices(props.report.meta))
const messages = computed(() =>
    notices.value.map((notice) => formatDataNotice(notice, props.locale)),
)
const isEmpty = computed(
    () => props.report.rows.length === 0 || dimensions.value.length + metrics.value.length === 0,
)

function valueFor(
    row: TableRow,
    column: string,
    kind: 'dimension' | 'metric',
): boolean | number | string | null {
    return tableCellValue(column, kind === 'dimension' ? row.dimensions : row.metrics)
}

function formattedValue(row: TableRow, column: string, kind: 'dimension' | 'metric'): string {
    return formatTableCell(valueFor(row, column, kind), props.locale, props.maximumFractionDigits)
}
</script>

<template>
    <section
        v-bind="$attrs"
        :aria-label="String($attrs['aria-label'] ?? 'Insight breakdown')"
        :class="[ui.root, props.class]"
        :data-slot="String($attrs['data-slot'] ?? 'root')"
    >
        <slot v-if="isEmpty" name="empty" :message="props.emptyText">
            <div aria-live="polite" :class="ui.empty" data-slot="empty" role="status">
                <strong>Insight breakdown</strong>
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
                name="notices"
                :messages
                :notices
                :quality="props.report.meta.quality"
            >
                <p aria-live="polite" :class="ui.notices" data-slot="notices" role="status">
                    {{ messages.join(' \u00b7 ') }}
                </p>
            </slot>
        </template>
    </section>
</template>
