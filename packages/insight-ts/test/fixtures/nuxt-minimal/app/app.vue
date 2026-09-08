<script setup lang="ts">
import { InsightChart } from '../../../../src/integrations/vue/ui/index.ts'

const data = {
    aggregate: { pageViews: 30 },
    meta: {
        quality: {},
        queriedAt: '2026-08-28T00:00:00.000Z',
        source: 'fixture',
        temporal: { grain: 'day' as const },
    },
    rows: [
        { time: '2026-08-27T00:00:00.000Z', values: { pageViews: 12 } },
        { time: '2026-08-28T00:00:00.000Z', values: { pageViews: 18 } },
    ],
}
</script>

<template><InsightChart :data="data" title="Fixture traffic" type="area" /></template>
