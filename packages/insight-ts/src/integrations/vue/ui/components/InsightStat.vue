<script setup lang="ts">
import { computed } from 'vue'

import type { ReportQuality } from '../../../../core/types.ts'
import {
    createDataNotices,
    createStatModel,
    formatDataNotice,
    formatMetricName,
    formatNumber,
    type DataNotice,
} from '../../../../ui-core/index.ts'
import { resolveInsightUIClass, type InsightStatProps, type InsightStatUI } from '../types.ts'

defineOptions({ inheritAttrs: false })

const props = withDefaults(defineProps<InsightStatProps>(), {
    emptyText: 'No data',
    locale: 'en-US',
    maximumFractionDigits: 2,
})

defineSlots<{
    empty(properties: { metric: string }): unknown
    label(properties: { label: string; metric: string }): unknown
    notices(properties: {
        messages: readonly string[]
        notices: readonly DataNotice[]
        quality: ReportQuality
    }): unknown
    value(properties: { formatted: string; metric: string; value: number }): unknown
}>()

const ui = computed<Required<InsightStatUI>>(() => ({
    empty: resolveInsightUIClass('insight-empty-state', props.ui?.empty),
    label: resolveInsightUIClass('insight-stat__label', props.ui?.label),
    notices: resolveInsightUIClass('insight-notices', props.ui?.notices),
    root: resolveInsightUIClass('insight-stat', props.ui?.root),
    value: resolveInsightUIClass('insight-stat__value', props.ui?.value),
}))
const selection = computed(() => createStatModel(props.report, props.metric))
const label = computed(() => props.label ?? formatMetricName(props.metric))
const value = computed(() => selection.value?.value ?? undefined)
const formatted = computed(() =>
    value.value === undefined
        ? ''
        : formatNumber(value.value, props.locale, props.maximumFractionDigits),
)
const notices = computed(() => createDataNotices(props.report.meta))
const messages = computed(() =>
    notices.value.map((notice) => formatDataNotice(notice, props.locale)),
)
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

        <slot v-else name="empty" :metric="props.metric">
            <div aria-live="polite" :class="ui.empty" data-slot="empty" role="status">
                <strong>{{ label }}</strong>
                <span>{{ props.emptyText }}</span>
            </div>
        </slot>
    </section>
</template>
