<script setup lang="ts">
import { AnalyticsAreaChart } from '@liria24/analytics/vue/ui'

const report = {
    kind: 'series' as const,
    meta: {
        quality: {},
        queriedAt: '2026-08-28T00:00:00.000Z',
        source: 'fixture',
        temporal: { grain: 'day' as const },
    },
    points: [
        { time: '2026-08-27T00:00:00.000Z', values: { pageViews: 12 } },
        { time: '2026-08-28T00:00:00.000Z', values: { pageViews: 18 } },
    ],
}
</script>

<template><AnalyticsAreaChart :report="report" title="Fixture traffic" /></template>
