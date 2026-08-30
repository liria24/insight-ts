<script setup lang="ts">
import { computed } from 'vue'

import { createDataNotices } from '../../../../ui-core/index.ts'
import {
    resolveInsightUIClass,
    type InsightQualityNoticeProps,
    type InsightQualityNoticeUI,
} from '../types.ts'

defineOptions({ inheritAttrs: false })

const props = defineProps<InsightQualityNoticeProps>()
const notices = computed(() => createDataNotices(props.data))
const ui = computed<Required<InsightQualityNoticeUI>>(() => ({
    item: resolveInsightUIClass('insight-quality-notice__item', props.ui?.item),
    list: resolveInsightUIClass('insight-quality-notice__list', props.ui?.list),
    root: resolveInsightUIClass('insight-quality-notice', props.ui?.root),
}))
</script>

<template>
    <aside
        v-if="notices.length"
        v-bind="$attrs"
        aria-live="polite"
        :class="[ui.root, props.class]"
        :data-slot="String($attrs['data-slot'] ?? 'root')"
        role="status"
    >
        <ul :class="ui.list" data-slot="list">
            <li v-for="notice in notices" :key="notice.code" :class="ui.item" data-slot="item">
                {{ notice.message }}
            </li>
        </ul>
    </aside>
</template>
