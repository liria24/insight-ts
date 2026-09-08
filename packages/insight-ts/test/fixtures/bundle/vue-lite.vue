<script setup lang="ts">
import { InsightBarList, InsightStat } from 'insight-ts/vue/ui'

const data = {
    aggregate: { views: 1 },
    meta: { queriedAt: '2026-08-31T00:00:00.000Z' },
    rows: [{ dimensions: { country: 'JP' }, values: { views: 1 } }],
}
</script>

<template>
    <InsightStat :data="data" />
    <InsightBarList :data="data" dimension="country" />
</template>
