<script setup lang="ts">
import type { AnalyticsSeriesReport } from '@liria24/analytics'

const { data, status } = await useFetch<AnalyticsSeriesReport>('/api/demo')
</script>

<template>
    <div class="demo-dashboard">
        <p v-if="status === 'pending'" aria-live="polite" role="status">Loading demo data…</p>
        <p v-else-if="!data" aria-live="polite" role="status">
            The demo report is unavailable right now.
        </p>
        <AnalyticsDashboard v-else :report="data" title="Demo traffic" />
    </div>
</template>
