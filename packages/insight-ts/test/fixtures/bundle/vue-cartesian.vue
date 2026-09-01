<script setup lang="ts">
import { InsightLineChart } from 'insight-ts/vue/ui'

const data = {
    data: {
        points: [{ time: '2026-08-31T00:00:00.000Z', values: { views: 1 } }],
        values: { views: 1 },
    },
    meta: { contributions: [], queriedAt: '2026-08-31T00:00:00.000Z' },
}
</script>

<template><InsightLineChart :data="data" /></template>
