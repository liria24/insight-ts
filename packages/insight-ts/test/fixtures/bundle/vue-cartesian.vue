<script setup lang="ts">
import { InsightLineChart } from 'insight-ts/vue/ui'

const data = {
    data: {
        points: [{ time: '2026-08-31T00:00:00.000Z', values: { views: 1 } }],
        values: { views: 1 },
    },
    meta: { queriedAt: '2026-08-31T00:00:00.000Z', source: 'fixture' },
}
</script>

<template><InsightLineChart :data="data" /></template>
