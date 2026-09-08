<script setup lang="ts">
import { computed } from 'vue'

import { createSeriesModel } from '../../../../ui-core/index.ts'
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

const model = computed(() =>
    createSeriesModel(props.data, {
        colors: ['currentColor'],
        maxPoints: 200,
    }),
)
const series = computed(() => model.value.series[0])
const metric = computed(() => series.value?.metric ?? '')
const values = computed(() => series.value?.values ?? [])
const path = computed(() => {
    if (values.value.length === 0) return ''
    const { max, min } = model.value.yDomain
    const span = max - min || 1
    const step = values.value.length === 1 ? 0 : props.width / (values.value.length - 1)
    return values.value
        .map(
            ({ value }, index) =>
                `${index === 0 ? 'M' : 'L'} ${index * step} ${props.height - ((value - min) / span) * props.height}`,
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
