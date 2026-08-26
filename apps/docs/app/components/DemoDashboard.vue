<script setup lang="ts">
import type { AnalyticsSeriesReport } from '@liria24/analytics'
import { AnalyticsLineChart, AnalyticsStat } from '@liria24/analytics/vue'

const { data, status } = useLazyFetch<AnalyticsSeriesReport>('/api/demo', {
    server: false,
})

const isLoading = computed(() => status.value === 'idle' || status.value === 'pending')
</script>

<template>
    <UCard
        class="demo-dashboard not-prose my-8"
        variant="subtle"
        :ui="{ body: 'p-0 sm:p-0', header: 'p-4 sm:px-5' }"
    >
        <template #header>
            <div class="flex items-start justify-between gap-4">
                <div class="min-w-0">
                    <h2 class="text-sm font-semibold text-highlighted">Demo traffic</h2>
                    <p class="mt-1 text-sm text-muted">
                        A sanitized daily report rendered with the optional Vue primitives.
                    </p>
                </div>
                <UBadge color="neutral" label="Aggregate report" variant="subtle" />
            </div>
        </template>

        <div v-if="isLoading" aria-live="polite" role="status">
            <span class="sr-only">Loading demo data…</span>
            <div class="grid divide-y divide-default sm:grid-cols-2 sm:divide-x sm:divide-y-0">
                <div v-for="index in 2" :key="index" class="space-y-3 p-5 sm:p-6">
                    <USkeleton class="h-4 w-24" />
                    <USkeleton class="h-9 w-32" />
                    <USkeleton class="h-4 w-28" />
                </div>
            </div>
            <div class="border-t border-default p-5 sm:p-6">
                <USkeleton class="h-72 w-full" />
            </div>
        </div>

        <div v-else-if="!data" class="p-4 sm:p-6">
            <UAlert
                color="neutral"
                description="Try refreshing the page or open the JSON response below."
                icon="i-lucide-circle-alert"
                title="The demo report is unavailable right now."
                variant="subtle"
            />
        </div>

        <div v-else>
            <div
                class="demo-dashboard__stats grid divide-y divide-default sm:grid-cols-2 sm:divide-x sm:divide-y-0"
            >
                <div class="p-5 sm:p-6">
                    <AnalyticsStat :report="data" metric="pageViews" />
                </div>
                <div class="p-5 sm:p-6">
                    <AnalyticsStat :report="data" metric="visits" />
                </div>
            </div>
            <div class="border-t border-default p-5 sm:p-6">
                <AnalyticsLineChart
                    :report="data"
                    :metrics="['pageViews', 'visits']"
                    :height="320"
                    title="Traffic over time"
                />
            </div>
        </div>
    </UCard>
</template>

<style scoped>
.demo-dashboard :deep(.analytics-stat__label),
.demo-dashboard :deep(.analytics-stat__value),
.demo-dashboard :deep(.analytics-stat__caption),
.demo-dashboard :deep(.analytics-line-chart__title) {
    margin: 0;
}

.demo-dashboard :deep(.analytics-stat__label) {
    color: var(--ui-text-muted);
    font-size: 0.75rem;
    font-weight: 500;
    line-height: 1rem;
    text-transform: uppercase;
    letter-spacing: 0.05em;
}

.demo-dashboard :deep(.analytics-stat__value) {
    margin-top: 0.5rem;
    color: var(--ui-text-highlighted);
    font-size: 1.875rem;
    font-variant-numeric: tabular-nums;
    font-weight: 600;
    line-height: 2.25rem;
    letter-spacing: -0.025em;
}

.demo-dashboard :deep(.analytics-stat__caption) {
    margin-top: 0.25rem;
    color: var(--ui-text-muted);
    font-size: 0.75rem;
    line-height: 1rem;
}

.demo-dashboard :deep(.analytics-line-chart__title) {
    color: var(--ui-text-highlighted);
    font-size: 0.875rem;
    font-weight: 600;
    line-height: 1.25rem;
}

.demo-dashboard :deep(.analytics-line-chart__canvas) {
    margin-top: 1rem;
    overflow: hidden;
    border-radius: var(--radius-md);
}

/* ponytail: adapt vue-data-ui's current defaults here; move theming into the primitive if more consumers need it. */
.demo-dashboard :deep(.vue-ui-xy),
.demo-dashboard :deep(.vue-ui-accordion-head),
.demo-dashboard :deep(.vue-ui-accordion-content) {
    background: transparent !important;
    color: var(--ui-text-muted) !important;
}

.demo-dashboard :deep(.vue-ui-xy text) {
    fill: var(--ui-text-muted) !important;
}

.demo-dashboard :deep(.vue-ui-xy [stroke='#e1e5e8ff' i]) {
    stroke: var(--ui-border) !important;
}

.demo-dashboard :deep(.vue-ui-xy [stroke^='#ffffff' i]) {
    stroke: var(--ui-bg) !important;
}
</style>
