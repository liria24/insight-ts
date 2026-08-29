<script setup lang="ts">
import { computed } from 'vue'

import type { InsightSparklineProps } from '../types.ts'

const props = withDefaults(defineProps<InsightSparklineProps>(), {
    height: 32,
    width: 96,
})

const values = computed(() =>
    (props.data.data[props.metric]?.points ?? []).flatMap(({ value }) =>
        value === null ? [] : [value],
    ),
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
</script>

<template>
    <svg
        :aria-label="`${props.metric} trend`"
        :class="['insight-sparkline', props.class]"
        :height="props.height"
        preserveAspectRatio="none"
        role="img"
        :viewBox="`0 0 ${props.width} ${props.height}`"
        :width="props.width"
    >
        <path v-if="path" :d="path" fill="none" vector-effect="non-scaling-stroke" />
    </svg>
</template>
