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
                        <p class="text-xs font-medium uppercase tracking-wider text-primary">
                            Overview
                        </p>
                        <h2 id="demo-overview" class="text-2xl font-semibold text-highlighted">
                            One typed query, several domains
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
                            :data="data.analytics.trafficSummary"
                            metric="pageViews"
                            :ui="statUi"
                        />
                        <InsightStat
                            class="p-5"
                            :data="data.analytics.trafficSummary"
                            metric="visits"
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
                                    :data="data.analytics.trafficSeries"
                                    metric="visits"
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
                        <p class="text-xs font-medium uppercase tracking-wider text-primary">
                            Analytics
                        </p>
                        <h2 id="demo-analytics" class="text-2xl font-semibold text-highlighted">
                            Cloudflare and Search Console semantics
                        </h2>
                    </div>
                    <div class="grid gap-5 xl:grid-cols-2">
                        <UCard variant="subtle">
                            <h3 class="mb-5 font-semibold text-highlighted">
                                Web Analytics breakdowns
                            </h3>
                            <InsightBarChart
                                :data="data.analytics.topPages"
                                dimension="path"
                                metric="pageViews"
                            />
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
                                    :data="data.analytics.searchSummary"
                                    metric="clicks"
                                    :ui="statUi"
                                />
                                <InsightStat
                                    :data="data.analytics.searchSummary"
                                    metric="impressions"
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
                        <p class="text-xs font-medium uppercase tracking-wider text-primary">
                            Product &amp; Revenue
                        </p>
                        <h2 id="demo-product" class="text-2xl font-semibold text-highlighted">
                            Application-owned metrics stay application-owned
                        </h2>
                    </div>
                    <div class="grid gap-5 xl:grid-cols-3">
                        <UCard variant="subtle"
                            ><InsightStat
                                :data="data.product.summary"
                                metric="signups"
                                :ui="statUi"
                        /></UCard>
                        <UCard variant="subtle"
                            ><InsightStat
                                :data="data.product.summary"
                                metric="activeTeams"
                                :ui="statUi"
                        /></UCard>
                        <UCard class="xl:row-span-2" variant="subtle">
                            <h3 class="mb-5 font-semibold text-highlighted">MRR by plan</h3>
                            <InsightBarChart
                                :data="data.product.revenue"
                                dimension="plan"
                                metric="mrr"
                            />
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
                                :data="data.observability.summary"
                                metric="requestRate"
                                :ui="statUi"
                            />
                            <InsightStat
                                :data="data.observability.summary"
                                metric="errorRate"
                                :ui="statUi"
                            />
                            <InsightStat
                                :data="data.observability.summary"
                                metric="latencyP95"
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
                        <p class="text-xs font-medium uppercase tracking-wider text-primary">
                            Data &amp; Execution
                        </p>
                        <h2 id="demo-data" class="text-2xl font-semibold text-highlighted">
                            Source-owned results in the same execution
                        </h2>
                    </div>
                    <DemoOwnedSourceResults :data="data" />
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
                                >{{ source }}</UBadge
                            >
                        </div>
                    </UCard>
                </section>
            </template>
        </template>
    </div>
</template>
