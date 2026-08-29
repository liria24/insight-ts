<script setup lang="ts">
import { computed } from 'vue'

import { formatNumber } from '../../../../ui-core/index.ts'
import type { InsightBarChartProps } from '../types.ts'

const props = withDefaults(defineProps<InsightBarChartProps>(), {
    emptyText: 'No data',
    height: 240,
    locale: 'en-US',
})

const rows = computed(() =>
    (props.data.data[props.metric]?.points ?? []).flatMap((point) => {
        const label = point.dimensions?.[props.dimension]
        return label === undefined || point.value === null
            ? []
            : [{ label: String(label), value: point.value }]
    }),
)
const maximum = computed(() => Math.max(0, ...rows.value.map(({ value }) => value)))
</script>

<template>
    <div
        :aria-label="`${props.metric} by ${props.dimension}`"
        :class="['insight-bar-chart', props.class]"
        role="figure"
        :style="{ minHeight: `${props.height}px` }"
    >
        <ol v-if="rows.length" class="insight-bar-chart__list">
            <li v-for="row in rows" :key="row.label" class="insight-bar-chart__item">
                <span class="insight-bar-chart__label">{{ row.label }}</span>
                <span class="insight-bar-chart__track">
                    <span
                        class="insight-bar-chart__bar"
                        :style="{ width: `${maximum === 0 ? 0 : (row.value / maximum) * 100}%` }"
                    />
                </span>
                <span class="insight-bar-chart__value">{{
                    props.formatter?.(row.value) ?? formatNumber(row.value, props.locale)
                }}</span>
            </li>
        </ol>
        <div v-else aria-live="polite" class="insight-empty-state" role="status">
            {{ props.emptyText }}
        </div>
    </div>
</template>
