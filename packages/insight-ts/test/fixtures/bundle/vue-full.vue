<script setup lang="ts">
// oxlint-disable-next-line import/no-unassigned-import -- verifies explicit and automatic style imports share one asset
import 'insight-ts/vue/ui/style.css'
import {
    InsightAreaChart,
    InsightBarChart,
    InsightBreakdownTable,
    InsightLineChart,
    InsightQualityNotice,
    InsightSparkline,
    InsightStat,
} from 'insight-ts/vue/ui'

const data = {
    aggregate: { views: 1 },
    meta: { queriedAt: '2026-08-31T00:00:00.000Z' },
    rows: [
        {
            dimensions: { country: 'JP' },
            time: '2026-08-31T00:00:00.000Z',
            values: { views: 1 },
        },
    ],
}
</script>

<template>
    <InsightStat :data="data" />
    <InsightLineChart :data="data" />
    <InsightAreaChart :data="data" />
    <InsightSparkline :data="data" />
    <InsightBarChart :data="data" dimension="country" />
    <InsightBreakdownTable :data="data" />
    <InsightQualityNotice :data="{}" />
</template>
