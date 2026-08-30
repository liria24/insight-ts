<script setup lang="ts">
const { data, status } = await useFetch<DemoReportResponse>('/api/demo', {
    query: { range: '7d' },
})

const isLoading = computed(() => status.value === 'idle' || status.value === 'pending')
</script>

<template>
    <section class="border-b border-default py-20 sm:py-28">
        <UContainer>
            <div class="grid gap-12 lg:grid-cols-[0.75fr_1.25fr] lg:items-center lg:gap-16">
                <div>
                    <p class="text-dimmed text-sm font-medium tracking-wide uppercase">
                        Insight UI
                    </p>
                    <h2
                        class="text-highlighted mt-4 text-4xl leading-tight font-semibold tracking-tight text-balance sm:text-5xl"
                    >
                        Metric results ready for your own interface.
                    </h2>
                    <p class="text-muted mt-6 text-lg leading-8">
                        UI components receive typed reports. They do not fetch Providers, store
                        credentials, run History, or impose application layout.
                    </p>
                    <p class="text-muted mt-4 leading-7">
                        This compact view uses the same `InsightStat` and `InsightAreaChart` as the
                        full demo, fixed to the last seven days.
                    </p>
                    <UButton
                        to="/demo"
                        label="Explore the live demo"
                        trailing-icon="mingcute:arrow-right-line"
                        variant="link"
                        color="neutral"
                        class="mt-5 px-0"
                    />
                </div>

                <div>
                    <InsightDemoDashboard compact :data="data" :loading="isLoading" />
                    <p class="text-dimmed mt-3 text-center text-xs">
                        Live Provider data when configured; deterministic fixture otherwise.
                    </p>
                </div>
            </div>
        </UContainer>
    </section>
</template>
