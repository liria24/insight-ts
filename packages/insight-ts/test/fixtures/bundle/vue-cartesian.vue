<script setup lang="ts">
import { InsightLineChart } from 'insight-ts/vue/ui'

const data = {
    data: {
        views: {
            points: [{ time: '2026-08-31T00:00:00.000Z', value: 1 }],
            value: 1,
        },
    },
    meta: { queriedAt: '2026-08-31T00:00:00.000Z', source: 'fixture' },
}
</script>

<template><InsightLineChart :data="data" /></template>
