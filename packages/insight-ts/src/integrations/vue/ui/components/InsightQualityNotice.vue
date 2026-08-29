<script setup lang="ts">
import { computed } from 'vue'

import { createDataNotices } from '../../../../ui-core/index.ts'
import type { InsightQualityNoticeProps } from '../types.ts'

const props = defineProps<InsightQualityNoticeProps>()
const notices = computed(() => createDataNotices(props.data))
</script>

<template>
    <aside
        v-if="notices.length"
        aria-live="polite"
        :class="['insight-quality-notice', props.class]"
        role="status"
    >
        <ul>
            <li v-for="notice in notices" :key="notice.code">{{ notice.message }}</li>
        </ul>
    </aside>
</template>
