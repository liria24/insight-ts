<script setup lang="ts">
import { computed } from 'vue'

import { formatNumber } from '../../../../ui-core/index.ts'
import { resolveInsightUIClass, type InsightBarListProps, type InsightBarListUI } from '../types.ts'

defineOptions({ inheritAttrs: false })

const props = withDefaults(defineProps<InsightBarListProps>(), {
    emptyText: 'No data',
    height: 240,
    locale: 'en-US',
})

const metric = computed(
    () =>
        Object.keys(props.data.aggregate ?? {})[0] ??
        Object.keys(props.data.rows?.[0]?.values ?? {})[0] ??
        '',
)
const rows = computed(() =>
    (props.data.rows ?? []).flatMap((point) => {
        const label = point.dimensions?.[props.dimension]
        const value = point.values[metric.value]
        return label === undefined || value === null || value === undefined
            ? []
            : [{ label: String(label), value }]
    }),
)
const maximum = computed(() => {
    let value = 0
    for (const row of rows.value) value = Math.max(value, row.value)
    return value
})
const ui = computed<Required<InsightBarListUI>>(() => ({
    bar: resolveInsightUIClass('insight-bar-list__bar', props.ui?.bar),
    empty: resolveInsightUIClass('insight-empty-state', props.ui?.empty),
    item: resolveInsightUIClass('insight-bar-list__item', props.ui?.item),
    label: resolveInsightUIClass('insight-bar-list__label', props.ui?.label),
    list: resolveInsightUIClass('insight-bar-list__list', props.ui?.list),
    root: resolveInsightUIClass('insight-bar-list', props.ui?.root),
    track: resolveInsightUIClass('insight-bar-list__track', props.ui?.track),
    value: resolveInsightUIClass('insight-bar-list__value', props.ui?.value),
}))
</script>

<template>
    <div
        v-bind="$attrs"
        :aria-label="String($attrs['aria-label'] ?? `${metric} by ${props.dimension}`)"
        :class="[ui.root, props.class]"
        :data-slot="String($attrs['data-slot'] ?? 'root')"
        role="figure"
        :style="{ minHeight: `${props.height}px` }"
    >
        <ol v-if="rows.length" :class="ui.list" data-slot="list">
            <li v-for="row in rows" :key="row.label" :class="ui.item" data-slot="item">
                <span :class="ui.label" data-slot="label">{{ row.label }}</span>
                <span :class="ui.track" data-slot="track">
                    <span
                        :class="ui.bar"
                        data-slot="bar"
                        :style="{ width: `${maximum === 0 ? 0 : (row.value / maximum) * 100}%` }"
                    />
                </span>
                <span :class="ui.value" data-slot="value">{{
                    props.formatter?.(row.value) ?? formatNumber(row.value, props.locale)
                }}</span>
            </li>
        </ol>
        <div v-else aria-live="polite" :class="ui.empty" data-slot="empty" role="status">
            {{ props.emptyText }}
        </div>
    </div>
</template>
