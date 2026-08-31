<script setup lang="ts">
import type { MetricQueryResult } from 'insight-ts/ui-core'
import {
    InsightAreaChart,
    InsightBarChart,
    InsightBreakdownTable,
    InsightLineChart,
    InsightQualityNotice,
    InsightSparkline,
    InsightStat,
} from 'insight-ts/vue/ui'

const props = withDefaults(
    defineProps<{
        compact?: boolean
        data?: DemoReportResponse | null
        loading?: boolean
    }>(),
    { compact: false, data: null, loading: false },
)

const timezone = computed(
    () => props.data?.analytics.trafficSeries.meta.temporal?.bucketTimezone ?? 'UTC',
)
const statUi = {
    label: 'text-xs font-medium uppercase tracking-wide text-muted',
    value: 'mt-2 text-3xl font-semibold tabular-nums tracking-tight text-highlighted',
} as const

const selectMetric = (data: MetricQueryResult, metric: string): MetricQueryResult => ({
    data: {
        ...(data.data.points
            ? {
                  points: data.data.points.map((point) => ({
                      ...point,
                      values: Object.hasOwn(point.values, metric)
                          ? { [metric]: point.values[metric] ?? null }
                          : {},
                  })),
              }
            : {}),
        values: Object.hasOwn(data.data.values, metric)
            ? { [metric]: data.data.values[metric] ?? null }
            : {},
    },
    meta: data.meta,
})
</script>

<template>
    <div class="demo-dashboard not-prose space-y-8">
        <UCard v-if="loading" variant="subtle">
            <div aria-live="polite" class="space-y-5" role="status">
                <span class="sr-only">Loading demo data…</span>
                <div class="grid gap-4 sm:grid-cols-3">
                    <USkeleton v-for="index in 3" :key="index" class="h-24" />
                </div>
                <USkeleton :class="compact ? 'h-56' : 'h-72'" class="w-full" />
            </div>
        </UCard>

        <UAlert
            v-else-if="!data"
            color="neutral"
            description="Try refreshing the page or open the live demo again shortly."
            icon="mingcute:information-line"
            title="The demo data is unavailable right now."
            variant="subtle"
        />

        <template v-else>
            <section aria-labelledby="demo-overview" class="space-y-4">
                <div class="flex items-end justify-between gap-4">
                    <div>
                        <h2 class="text-xs font-medium uppercase tracking-wider text-primary">
                            Overview
                        </h2>
                    </div>
                    <span class="text-sm text-muted">{{ data.online }} online</span>
                </div>
                <UCard variant="subtle" :ui="{ body: 'p-0 sm:p-0' }">
                    <div
                        class="grid divide-y divide-default sm:grid-cols-3 sm:divide-x sm:divide-y-0"
                    >
                        <InsightStat
                            class="p-5"
                            :data="selectMetric(data.analytics.trafficSummary, 'pageViews')"
                            :ui="statUi"
                        />
                        <InsightStat
                            class="p-5"
                            :data="selectMetric(data.analytics.trafficSummary, 'visits')"
                            :ui="statUi"
                        />
                        <div class="p-5">
                            <p class="text-xs font-medium uppercase tracking-wide text-muted">
                                Recent visits
                            </p>
                            <div class="mt-2 flex items-end justify-between gap-4">
                                <strong class="text-3xl tabular-nums text-highlighted">{{
                                    data.online
                                }}</strong>
                                <InsightSparkline
                                    :data="selectMetric(data.analytics.trafficSeries, 'visits')"
                                />
                            </div>
                        </div>
                    </div>
                    <div class="border-t border-default p-5 sm:p-6">
                        <InsightAreaChart
                            :data="data.analytics.trafficSeries"
                            :height="compact ? 240 : 320"
                            locale="en-US"
                            title="Traffic over time"
                            :timezone="timezone"
                        />
                        <InsightQualityNotice
                            class="mt-3 text-xs text-muted"
                            :data="data.analytics.trafficSeries.meta.quality"
                        />
                    </div>
                </UCard>
            </section>

            <template v-if="!compact">
                <section aria-labelledby="demo-analytics" class="space-y-4">
                    <div>
                        <h2 class="text-xs font-medium uppercase tracking-wider text-primary">
                            Analytics
                        </h2>
                    </div>
                    <div class="grid gap-5 xl:grid-cols-2">
                        <UCard variant="subtle">
                            <h3 class="mb-5 font-semibold text-highlighted">
                                Web Analytics breakdowns
                            </h3>
                            <InsightBarChart :data="data.analytics.topPages" dimension="path" />
                            <div class="mt-6 grid gap-5 md:grid-cols-2">
                                <InsightBreakdownTable :data="data.analytics.countries" />
                                <InsightBreakdownTable :data="data.analytics.devices" />
                            </div>
                            <div class="mt-5">
                                <InsightBreakdownTable :data="data.analytics.referrers" />
                            </div>
                        </UCard>
                        <UCard variant="subtle">
                            <div class="grid grid-cols-2 gap-4">
                                <InsightStat
                                    :data="selectMetric(data.analytics.searchSummary, 'clicks')"
                                    :ui="statUi"
                                />
                                <InsightStat
                                    :data="
                                        selectMetric(data.analytics.searchSummary, 'impressions')
                                    "
                                    :ui="statUi"
                                />
                            </div>
                            <InsightLineChart
                                class="mt-6"
                                :data="data.analytics.searchSeries"
                                title="Search performance"
                                :timezone="timezone"
                            />
                            <div class="mt-6 grid gap-5 md:grid-cols-2">
                                <InsightBreakdownTable :data="data.analytics.searchQueries" />
                                <InsightBreakdownTable :data="data.analytics.searchPages" />
                            </div>
                        </UCard>
                    </div>
                </section>

                <section aria-labelledby="demo-product" class="space-y-4">
                    <div>
                        <h2 class="text-xs font-medium uppercase tracking-wider text-primary">
                            Product &amp; Revenue
                        </h2>
                    </div>
                    <div class="grid gap-5 xl:grid-cols-3">
                        <UCard variant="subtle">
                            <InsightStat
                                :data="selectMetric(data.product.summary, 'signups')"
                                :ui="statUi"
                            />
                        </UCard>
                        <UCard variant="subtle">
                            <InsightStat
                                :data="selectMetric(data.product.summary, 'activeTeams')"
                                :ui="statUi"
                            />
                        </UCard>
                        <UCard class="xl:row-span-2" variant="subtle">
                            <h3 class="mb-5 font-semibold text-highlighted">MRR by plan</h3>
                            <InsightBarChart :data="data.product.revenue" dimension="plan" />
                        </UCard>
                        <UCard class="xl:col-span-2" variant="subtle">
                            <InsightAreaChart
                                :data="data.product.series"
                                title="Product growth"
                                :timezone="timezone"
                            />
                        </UCard>
                    </div>
                </section>

                <section aria-labelledby="demo-observability" class="space-y-4">
                    <div>
                        <p class="text-xs font-medium uppercase tracking-wider text-primary">
                            Observability
                        </p>
                        <h2 id="demo-observability" class="text-2xl font-semibold text-highlighted">
                            OTel-aligned metrics without making OTel the data model
                        </h2>
                    </div>
                    <UCard variant="subtle">
                        <div class="grid gap-5 sm:grid-cols-3">
                            <InsightStat
                                :data="selectMetric(data.observability.summary, 'requestRate')"
                                :ui="statUi"
                            />
                            <InsightStat
                                :data="selectMetric(data.observability.summary, 'errorRate')"
                                :ui="statUi"
                            />
                            <InsightStat
                                :data="selectMetric(data.observability.summary, 'latencyP95')"
                                :ui="statUi"
                            />
                        </div>
                        <InsightLineChart
                            class="mt-6"
                            :data="data.observability.series"
                            title="Service health"
                            :timezone="timezone"
                        />
                        <InsightQualityNotice
                            class="mt-3 text-xs text-muted"
                            :data="data.observability.series.meta.quality"
                        />
                    </UCard>
                </section>

                <section aria-labelledby="demo-data" class="space-y-4">
                    <div>
                        <h2 class="text-xs font-medium uppercase tracking-wider text-primary">
                            Data &amp; Execution
                        </h2>
                    </div>
                    <DemoOwnedSourceResults :data />
                    <UCard variant="subtle">
                        <p class="text-sm text-muted">
                            Queried {{ data.execution.sources.length }} Sources at
                            {{ data.execution.queriedAt }}
                        </p>
                        <div class="mt-3 flex flex-wrap gap-2">
                            <UBadge
                                v-for="source in data.execution.sources"
                                :key="source"
                                color="neutral"
                                variant="subtle"
                            >
                                {{ source }}
                            </UBadge>
                        </div>
                    </UCard>
                </section>
            </template>
        </template>
    </div>
</template>
