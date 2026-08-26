<script setup lang="ts">
import { computed } from 'vue'

import type { AnalyticsReportQuality, AnalyticsSeriesPoint } from '../core/types'
import {
    formatMetricName,
    formatNumber,
    qualityMessages,
    selectStatValue,
    type AnalyticsStatProps,
} from '../vue-ui'

const props = withDefaults(defineProps<AnalyticsStatProps>(), {
    emptyText: 'No data',
    locale: 'en-US',
    maximumFractionDigits: 2,
})

defineSlots<{
    caption(properties: { point: AnalyticsSeriesPoint }): unknown
    empty(properties: { metric: string }): unknown
    label(properties: { label: string; metric: string }): unknown
    quality(properties: { messages: readonly string[]; quality: AnalyticsReportQuality }): unknown
    value(properties: {
        formatted: string
        metric: string
        point: AnalyticsSeriesPoint | undefined
        value: number
    }): unknown
}>()

const selection = computed(() => selectStatValue(props.report, props.metric))
const label = computed(() => props.label ?? formatMetricName(props.metric))
const value = computed(() => {
    const selected = selection.value?.value
    return typeof selected === 'number' && Number.isFinite(selected) ? selected : undefined
})
const hasValue = computed(() => value.value !== undefined)
const formatted = computed(() =>
    value.value === undefined
        ? ''
        : formatNumber(value.value, props.locale, props.maximumFractionDigits),
)
const messages = computed(() => qualityMessages(props.report.meta.quality))
</script>

<template>
    <section v-if="hasValue && selection" :aria-label="label" class="analytics-stat">
        <slot name="label" :label="label" :metric="props.metric">
            <p class="analytics-stat__label">{{ label }}</p>
        </slot>

        <slot
            name="value"
            :formatted="formatted"
            :metric="props.metric"
            :point="selection.point"
            :value="value ?? 0"
        >
            <p class="analytics-stat__value">{{ formatted }}</p>
        </slot>

        <slot v-if="selection.point" name="caption" :point="selection.point">
            <p class="analytics-stat__caption">As of {{ selection.point.time.slice(0, 10) }}</p>
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

    <slot v-else name="empty" :metric="props.metric">
        <div :aria-label="label" aria-live="polite" class="analytics-empty-state" role="status">
            <strong>{{ label }}</strong>
            <span>{{ props.emptyText }}</span>
        </div>
    </slot>
</template>
