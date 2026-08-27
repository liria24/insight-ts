<script setup lang="ts">
import { CalendarDate, today } from '@internationalized/date'
import { AnalyticsLineChart, AnalyticsStat, resolveAnalyticsTimezone } from '@liria24/analytics/vue'
import { withHttps } from 'ufo'

import { demoRangeOptions, type DemoRangePreset, type DemoReportResponse } from '#shared/demo-range'

const { app } = useAppConfig()

const selectedRange = ref<DemoRangePreset | 'custom'>('7d')
const calendarToday = today('UTC')
const calendarRange = shallowRef({
    end: calendarToday,
    start: calendarToday.subtract({ days: 6 }),
})
const reportQuery = computed(() =>
    selectedRange.value === 'custom'
        ? {
              from: `${calendarRange.value.start.toString()}T00:00:00.000Z`,
              to: `${calendarRange.value.end.add({ days: 1 }).toString()}T00:00:00.000Z`,
          }
        : { range: selectedRange.value },
)
const rangeItems = computed(() =>
    selectedRange.value === 'custom'
        ? [...demoRangeOptions, { label: customRangeLabel.value, value: 'custom' }]
        : [...demoRangeOptions],
)

const { data, status } = useLazyFetch<DemoReportResponse>('/api/demo', {
    query: reportQuery,
    server: false,
})
const { data: onlineData } = useLazyFetch<{ online: number }>('/api/demo/online', {
    default: () => ({ online: 0 }),
    server: false,
})

const locale = 'en-US'
const isLoading = computed(() => status.value === 'idle' || status.value === 'pending')
const timezone = computed(() => (data.value ? resolveAnalyticsTimezone(data.value.series) : 'UTC'))
const online = computed(() => Math.max(0, Math.round(onlineData.value?.online ?? 0)))
const customRangeLabel = computed(() => {
    const formatter = new Intl.DateTimeFormat(locale, {
        day: 'numeric',
        month: 'short',
        timeZone: 'UTC',
        year: 'numeric',
    })
    const start = new Date(`${calendarRange.value.start.toString()}T00:00:00.000Z`)
    const end = new Date(`${calendarRange.value.end.toString()}T00:00:00.000Z`)
    return `${formatter.format(start)} – ${formatter.format(end)}`
})

watch(calendarRange, ({ end, start }) => {
    if (start && end) selectedRange.value = 'custom'
})
</script>

<template>
    <UContainer class="pt-8">
        <div class="flex flex-col gap-4 sm:flex-row sm:items-center">
            <div class="flex flex-col gap-2">
                <h2 class="text-highlighted text-4xl">Web Analytics</h2>

                <div class="flex gap-3 items-center">
                    <ULink :to="withHttps(app.domain)" class="text-sm">
                        {{ app.domain }}
                    </ULink>
                    <USeparator orientation="vertical" class="h-4" />
                    <div class="flex items-center gap-2">
                        <div
                            class="size-2.5 rounded-full"
                            :class="online > 0 ? 'bg-success' : 'bg-muted'"
                        />
                        <span aria-live="polite" class="text-sm text-muted"
                            >{{ online }} online</span
                        >
                    </div>
                </div>
            </div>

            <UFieldGroup class="sm:ml-auto">
                <UPopover>
                    <UButton
                        aria-label="Select custom date range"
                        icon="mingcute:calendar-2-fill"
                        variant="outline"
                        color="neutral"
                    />

                    <template #content>
                        <UCalendar
                            v-model="calendarRange"
                            class="p-2"
                            :max-value="calendarToday"
                            :min-value="calendarToday.subtract({ years: 1 })"
                            :number-of-months="2"
                            range
                        />
                    </template>
                </UPopover>
                <USelect
                    v-model="selectedRange"
                    :items="rangeItems"
                    color="neutral"
                    class="min-w-44"
                    label-key="label"
                    value-key="value"
                />
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
                <div class="grid divide-y divide-default sm:grid-cols-2 sm:divide-x sm:divide-y-0">
                    <AnalyticsStat
                        :report="data.summary"
                        metric="pageViews"
                        :ui="{
                            caption: 'mt-1 text-xs text-muted',
                            label: 'text-xs font-medium uppercase tracking-wide text-muted',
                            value: 'mt-2 text-3xl font-semibold tabular-nums tracking-tight text-highlighted',
                        }"
                        class="p-5 sm:p-6"
                    />
                    <AnalyticsStat
                        :report="data.summary"
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
                        :report="data.series"
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
            </div>
        </UCard>
    </UContainer>
</template>
