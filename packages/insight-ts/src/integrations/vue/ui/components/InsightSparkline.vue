<script setup lang="ts">
import { computed } from 'vue'

import {
    resolveInsightUIClass,
    type InsightSparklineProps,
    type InsightSparklineUI,
} from '../types.ts'

defineOptions({ inheritAttrs: false })

const props = withDefaults(defineProps<InsightSparklineProps>(), {
    height: 32,
    width: 96,
})

const metric = computed(() => Object.keys(props.data.data.values)[0] ?? '')
const values = computed(() =>
    (props.data.data.points ?? []).flatMap(({ values: pointValues }) => {
        const value = pointValues[metric.value]
        return value === null || value === undefined ? [] : [value]
    }),
)
const path = computed(() => {
    if (values.value.length === 0) return ''
    const minimum = Math.min(...values.value)
    const span = Math.max(...values.value) - minimum || 1
    const step = values.value.length === 1 ? 0 : props.width / (values.value.length - 1)
    return values.value
        .map(
            (value, index) =>
                `${index === 0 ? 'M' : 'L'} ${index * step} ${props.height - ((value - minimum) / span) * props.height}`,
        )
        .join(' ')
})
const ui = computed<Required<InsightSparklineUI>>(() => ({
    path: resolveInsightUIClass('insight-sparkline__path', props.ui?.path),
    root: resolveInsightUIClass('insight-sparkline', props.ui?.root),
}))
</script>

<template>
    <svg
        v-bind="$attrs"
        :aria-label="String($attrs['aria-label'] ?? `${metric} trend`)"
        :class="[ui.root, props.class]"
        :data-slot="String($attrs['data-slot'] ?? 'root')"
        :height="props.height"
        preserveAspectRatio="none"
        role="img"
        :viewBox="`0 0 ${props.width} ${props.height}`"
        :width="props.width"
    >
        <path
            v-if="path"
            :class="ui.path"
            data-slot="path"
            :d="path"
            fill="none"
            vector-effect="non-scaling-stroke"
        />
    </svg>
</template>
