<script setup lang="ts">
import type { AnalyticsSeriesReport } from '@liria24/analytics'
import { AnalyticsLineChart, AnalyticsStat } from '@liria24/analytics/vue'

const { data, status } = useLazyFetch<AnalyticsSeriesReport>('/api/demo', {
    server: false,
})
</script>

<template>
    <div class="demo-dashboard">
        <p v-if="status === 'pending'" aria-live="polite" role="status">Loading demo data…</p>
        <p v-else-if="!data" aria-live="polite" role="status">
            The demo report is unavailable right now.
        </p>
        <template v-else>
            <div class="demo-dashboard__stats">
                <AnalyticsStat :report="data" metric="pageViews" />
                <AnalyticsStat :report="data" metric="visits" />
            </div>
            <AnalyticsLineChart
                :report="data"
                :metrics="['pageViews', 'visits']"
                title="Demo traffic"
            />
        </template>
    </div>
</template>
