<script setup lang="ts">
import { computed } from 'vue'

import type { AnalyticsReportQuality, AnalyticsTableReport, AnalyticsTableRow } from '../core/types'
import {
    formatMetricName,
    formatTableCell,
    qualityMessages,
    resolveTableFields,
    tableCellValue,
    type AnalyticsBreakdownTableProps,
} from '../vue-ui'

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
    empty(properties: { reason: 'empty' | 'kind' }): unknown
    header(properties: { column: string }): unknown
    quality(properties: { messages: readonly string[]; quality: AnalyticsReportQuality }): unknown
    table(properties: {
        dimensions: readonly string[]
        metrics: readonly string[]
        rows: readonly AnalyticsTableRow[]
    }): unknown
}>()

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
    <slot v-if="!tableReport" name="empty" reason="kind">
        <div
            aria-label="Analytics breakdown"
            aria-live="polite"
            class="analytics-empty-state"
            role="status"
        >
            <strong>Analytics breakdown</strong>
            <span>No breakdown data</span>
        </div>
    </slot>

    <slot v-else-if="isEmpty" name="empty" reason="empty">
        <div
            aria-label="Analytics breakdown"
            aria-live="polite"
            class="analytics-empty-state"
            role="status"
        >
            <strong>Analytics breakdown</strong>
            <span>{{ props.emptyText }}</span>
        </div>
    </slot>

    <section v-else aria-label="Analytics breakdown" class="analytics-breakdown-table">
        <slot name="table" :dimensions="dimensions" :metrics="metrics" :rows="tableReport.rows">
            <table class="analytics-breakdown-table__table">
                <thead>
                    <tr>
                        <th v-for="column in headers" :key="column" scope="col">
                            <slot name="header" :column="column">
                                {{ formatMetricName(column) }}
                            </slot>
                        </th>
                    </tr>
                </thead>
                <tbody>
                    <tr v-for="(row, rowIndex) in tableReport.rows" :key="rowIndex">
                        <td v-for="column in dimensions" :key="`dimension:${column}`">
                            <slot
                                name="cell"
                                :column="column"
                                :formatted="formattedValue(row, column, 'dimension')"
                                kind="dimension"
                                :row-index="rowIndex"
                                :value="valueFor(row, column, 'dimension')"
                            >
                                {{ formattedValue(row, column, 'dimension') }}
                            </slot>
                        </td>
                        <td v-for="column in metrics" :key="`metric:${column}`">
                            <slot
                                name="cell"
                                :column="column"
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
        </slot>

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
