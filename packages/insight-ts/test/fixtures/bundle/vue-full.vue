<script setup lang="ts">
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
    data: {
        views: {
            points: [
                {
                    dimensions: { country: 'JP' },
                    time: '2026-08-31T00:00:00.000Z',
                    value: 1,
                },
            ],
            value: 1,
        },
    },
    meta: { queriedAt: '2026-08-31T00:00:00.000Z', source: 'fixture' },
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
