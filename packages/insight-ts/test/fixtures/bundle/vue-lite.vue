<script setup lang="ts">
import { InsightQualityNotice, InsightStat } from 'insight-ts/vue/ui'

const data = {
    data: { values: { views: 1 } },
    meta: { queriedAt: '2026-08-31T00:00:00.000Z', source: 'fixture' },
}
</script>

<template>
    <InsightStat :data="data" />
    <InsightQualityNotice :data="{}" />
</template>
