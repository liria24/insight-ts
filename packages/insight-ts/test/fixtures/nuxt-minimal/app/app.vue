<script setup lang="ts">
import { InsightAreaChart } from '../../../../src/integrations/vue/ui/index.ts'

const data = {
    data: {
        points: [
            { time: '2026-08-27T00:00:00.000Z', values: { pageViews: 12 } },
            { time: '2026-08-28T00:00:00.000Z', values: { pageViews: 18 } },
        ],
        values: { pageViews: 30 },
    },
    meta: {
        quality: {},
        queriedAt: '2026-08-28T00:00:00.000Z',
        source: 'fixture',
        temporal: { grain: 'day' as const },
    },
}
</script>

<template><InsightAreaChart :data="data" title="Fixture traffic" /></template>
