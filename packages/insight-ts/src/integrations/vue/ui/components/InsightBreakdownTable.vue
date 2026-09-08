<script setup lang="ts">
import { computed } from 'vue'

import type { QueryQuality } from '../../../../core/types.ts'
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
        quality: QueryQuality | undefined
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
const model = computed(() => createBreakdownModel(props.data))
const dimensions = computed(() => model.value.dimensions)
const metrics = computed(() => model.value.metrics)
const headers = computed(() => [
    ...dimensions.value.map((column) => ({ column, kind: 'dimension' as const })),
    ...metrics.value.map((column) => ({ column, kind: 'metric' as const })),
])
const rows = computed(() =>
    model.value.rows.map((row) => ({
        cells: headers.value.map(({ column, kind }) => {
            const value = tableCellValue(
                column,
                kind === 'dimension' ? row.dimensions : row.metrics,
            )
            return {
                column,
                formatted: formatTableCell(value, props.locale, props.maximumFractionDigits),
                kind,
                value,
            }
        }),
        key: row.key,
    })),
)
const notices = computed(() => createDataNotices(props.data.meta.quality))
const messages = computed(() => notices.value.map(formatDataNotice))
const isEmpty = computed(() => rows.value.length === 0 || headers.value.length === 0)
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
                            v-for="header in headers"
                            :key="`${header.kind}:${header.column}`"
                            :class="ui.headerCell"
                            data-slot="header-cell"
                            scope="col"
                        >
                            <slot name="header" :column="header.column">
                                {{ formatMetricName(header.column) }}
                            </slot>
                        </th>
                    </tr>
                </thead>
                <tbody :class="ui.body" data-slot="body">
                    <tr
                        v-for="(row, rowIndex) in rows"
                        :key="row.key"
                        :class="ui.row"
                        data-slot="row"
                    >
                        <td
                            v-for="cell in row.cells"
                            :key="`${cell.kind}:${cell.column}`"
                            :class="ui.cell"
                            data-slot="cell"
                        >
                            <slot
                                name="cell"
                                :column="cell.column"
                                :formatted="cell.formatted"
                                :kind="cell.kind"
                                :row-index="rowIndex"
                                :value="cell.value"
                            >
                                {{ cell.formatted }}
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
                :quality="props.data.meta.quality"
            >
                <p aria-live="polite" :class="ui.notices" data-slot="notices" role="status">
                    {{ messages.join(' \u00b7 ') }}
                </p>
            </slot>
        </template>
    </section>
</template>
