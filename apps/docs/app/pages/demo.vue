<script setup lang="ts">
import { CalendarDate, today } from '@internationalized/date'
import { withHttps } from 'ufo'

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

const { data, status } = await useFetch<DemoReportResponse>('/api/demo', {
    query: reportQuery,
})

const locale = 'en-US'
const isLoading = computed(() => status.value === 'idle' || status.value === 'pending')
const online = computed(() => Math.max(0, Math.round(data.value?.online ?? 0)))
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
                <h1 class="text-highlighted text-4xl">Insight.ts Source Demo</h1>

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
                            >{{ online }} online · app KPI from 5-minute visits</span
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

        <InsightDemoDashboard class="my-8" :data="data" :loading="isLoading" />
    </UContainer>
</template>
