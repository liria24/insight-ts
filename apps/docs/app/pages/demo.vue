<script setup lang="ts">
import type { AnalyticsSeriesReport } from '@liria24/analytics'
import { AnalyticsLineChart, AnalyticsStat, resolveAnalyticsTimezone } from '@liria24/analytics/vue'
import { withHttps } from 'ufo'

const { app } = useAppConfig()

const { data, status } = useLazyFetch<AnalyticsSeriesReport>('/api/demo', {
    server: false,
})

const locale = 'en-US'
const isLoading = computed(() => status.value === 'idle' || status.value === 'pending')

const range = ref<[number, number]>([0, 0])
const maxRangeIndex = computed(() => Math.max((data.value?.points.length ?? 1) - 1, 0))
const timezone = computed(() => (data.value ? resolveAnalyticsTimezone(data.value) : 'UTC'))
const visibleReport = computed<AnalyticsSeriesReport | undefined>(() => {
    const report = data.value
    if (!report) return undefined
    return selectDemoReportRange(report, range.value)
})

watch(
    data,
    (report) => {
        if (report) range.value = [0, Math.max(report.points.length - 1, 0)]
    },
    { immediate: true },
)

const rangeLabel = (index: number): string => {
    const report = data.value
    return report ? formatDemoReportTime(report, index, locale, timezone.value) : ''
}
</script>

<template>
    <UContainer class="pt-8">
        <div class="flex items-center gap-4">
            <div class="flex flex-col gap-2">
                <h2 class="text-highlighted text-4xl">Web Analytics</h2>

                <div class="flex gap-3 items-center">
                    <ULink :to="withHttps(app.domain)" class="text-sm">
                        {{ app.domain }}
                    </ULink>
                    <USeparator orientation="vertical" class="h-4" />
                    <div class="flex items-center gap-2">
                        <div class="size-2.5 rounded-full bg-muted" />
                        <span class="text-sm text-muted">0 online</span>
                    </div>
                </div>
            </div>

            <UFieldGroup class="ml-auto">
                <UButton
                    aria-label="Select range"
                    icon="mingcute:calendar-2-fill"
                    variant="outline"
                    color="neutral"
                />
                <USelect :items="[{ label: 'Last 7 Days' }]" color="neutral" class="min-w-40" />
            </UFieldGroup>
        </div>

        <UCard
            class="demo-dashboard not-prose my-8"
            variant="subtle"
            :ui="{ body: 'p-0 sm:p-0', header: 'p-6 sm:px-7' }"
        >
            <div v-if="isLoading" aria-live="polite" role="status">
                <span class="sr-only">Loading demo data…</span>
                <div class="border-b border-default p-5 sm:p-6">
                    <USkeleton class="h-4 w-full" />
                </div>
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

            <div v-else-if="!data || !visibleReport" class="p-4 sm:p-6">
                <UAlert
                    color="neutral"
                    description="Try refreshing the page or open the JSON response below."
                    icon="i-lucide-circle-alert"
                    title="The demo report is unavailable right now."
                    variant="subtle"
                />
            </div>

            <div v-else>
                <div class="grid divide-y divide-default sm:grid-cols-2 sm:divide-x sm:divide-y-0">
                    <AnalyticsStat
                        :report="visibleReport"
                        metric="pageViews"
                        :ui="{
                            caption: 'mt-1 text-xs text-muted',
                            label: 'text-xs font-medium uppercase tracking-wide text-muted',
                            value: 'mt-2 text-3xl font-semibold tabular-nums tracking-tight text-highlighted',
                        }"
                        class="p-5 sm:p-6"
                    />
                    <AnalyticsStat
                        :report="visibleReport"
                        metric="visits"
                        :ui="{
                            caption: 'mt-1 text-xs text-muted',
                            label: 'text-xs font-medium uppercase tracking-wide text-muted',
                            value: 'mt-2 text-3xl font-semibold tabular-nums tracking-tight text-highlighted',
                        }"
                        class="p-5 sm:p-6"
                    />
                </div>
                <div class="border-t border-default p-5 sm:p-6">
                    <AnalyticsLineChart
                        title="Traffic over time"
                        :metrics="['pageViews', 'visits']"
                        :report="visibleReport"
                        :timezone
                        :locale
                        :height="320"
                        :ui="{
                            chart: 'mt-4 overflow-hidden rounded-md',
                            legend: 'flex gap-3 text-xs text-muted',
                            title: 'text-sm font-semibold text-highlighted',
                        }"
                    />
                </div>

                <div class="border-b border-default p-7 sm:p-8">
                    <div class="mb-3 flex items-center justify-between gap-4 text-xs text-muted">
                        <time :datetime="data.points[range[0]]?.time">{{
                            rangeLabel(range[0])
                        }}</time>
                        <time :datetime="data.points[range[1]]?.time">{{
                            rangeLabel(range[1])
                        }}</time>
                    </div>
                    <USlider
                        v-model="range"
                        aria-label="Visible report date range"
                        :max="maxRangeIndex"
                        :min="0"
                        :step="1"
                    />
                </div>
            </div>
        </UCard>
    </UContainer>
</template>
