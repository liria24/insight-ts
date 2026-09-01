<script setup lang="ts">
import { InsightQualityNotice, InsightStat } from 'insight-ts/vue/ui'

const data = {
    data: { values: { views: 1 } },
    meta: { contributions: [], queriedAt: '2026-08-31T00:00:00.000Z' },
}
</script>

<template>
    <InsightStat :data="data" />
    <InsightQualityNotice :data="{}" />
</template>
