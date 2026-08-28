<script setup lang="ts">
import { computed } from 'vue'

import type { AnalyticsReportQuality } from '../core/types'
import { formatMetricName, formatNumber, qualityMessages, selectStatValue } from '../presentation'
import { resolveAnalyticsUIClass, type AnalyticsStatProps, type AnalyticsStatUI } from '../vue-ui'

defineOptions({ inheritAttrs: false })

const props = withDefaults(defineProps<AnalyticsStatProps>(), {
    emptyText: 'No data',
    locale: 'en-US',
    maximumFractionDigits: 2,
})

defineSlots<{
    empty(properties: { metric: string }): unknown
    label(properties: { label: string; metric: string }): unknown
    quality(properties: { messages: readonly string[]; quality: AnalyticsReportQuality }): unknown
    value(properties: { formatted: string; metric: string; value: number }): unknown
}>()

const ui = computed<Required<AnalyticsStatUI>>(() => ({
    empty: resolveAnalyticsUIClass('analytics-empty-state', props.ui?.empty),
    label: resolveAnalyticsUIClass('analytics-stat__label', props.ui?.label),
    quality: resolveAnalyticsUIClass('analytics-quality', props.ui?.quality),
    root: resolveAnalyticsUIClass('analytics-stat', props.ui?.root),
    value: resolveAnalyticsUIClass('analytics-stat__value', props.ui?.value),
}))
const selection = computed(() => selectStatValue(props.report, props.metric))
const label = computed(() => props.label ?? formatMetricName(props.metric))
const value = computed(() => selection.value?.value ?? undefined)
const formatted = computed(() =>
    value.value === undefined
        ? ''
        : formatNumber(value.value, props.locale, props.maximumFractionDigits),
)
const messages = computed(() => qualityMessages(props.report.meta.quality))
</script>

<template>
    <section
        v-bind="$attrs"
        :aria-label="String($attrs['aria-label'] ?? label)"
        :class="[ui.root, props.class]"
        :data-slot="String($attrs['data-slot'] ?? 'root')"
    >
        <template v-if="value !== undefined">
            <slot name="label" :label :metric="props.metric">
                <p :class="ui.label" data-slot="label">{{ label }}</p>
            </slot>

            <slot name="value" :formatted :metric="props.metric" :value>
                <p :class="ui.value" data-slot="value">{{ formatted }}</p>
            </slot>

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

        <slot v-else name="empty" :metric="props.metric">
            <div aria-live="polite" :class="ui.empty" data-slot="empty" role="status">
                <strong>{{ label }}</strong>
                <span>{{ props.emptyText }}</span>
            </div>
        </slot>
    </section>
</template>
