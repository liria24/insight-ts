<script setup lang="ts">
const inferredTypes = [
    { label: 'source', value: "'cloudflare.webAnalytics'" },
    { label: 'query', value: "MetricQuery<'pageViews' | 'visits'>" },
    { label: 'metrics', value: "'pageViews' | 'visits'" },
    { label: 'result', value: "QueryResult<MetricData<'pageViews' | 'visits'>>" },
]

const principles = [
    {
        title: 'Provider-aware',
        description: 'Each Source keeps provider limits, sampling, freshness, and quality visible.',
        icon: 'mingcute:layers-line',
    },
    {
        title: 'Typed end to end',
        description:
            'Source, query, metric, dimension, and selected result keys stay literal through one execution.',
        icon: 'mingcute:code-line',
    },
    {
        title: 'Optional by design',
        description:
            'Core imports no Provider, History engine, framework, runtime, CSS, or renderer you did not choose.',
        icon: 'mingcute:checkbox-line',
    },
]
</script>

<template>
    <section class="border-b border-default py-20 sm:py-28">
        <UContainer>
            <div class="grid items-start gap-12 lg:grid-cols-[0.85fr_1.15fr] lg:gap-20">
                <div class="lg:sticky lg:top-28">
                    <p class="text-dimmed text-sm font-medium tracking-wide uppercase">
                        Typed capability
                    </p>
                    <h2
                        class="text-highlighted mt-4 text-4xl leading-tight font-semibold tracking-tight text-balance sm:text-5xl"
                    >
                        Queries that keep Provider details visible.
                    </h2>
                    <p class="text-muted mt-6 text-lg leading-8">
                        Providers expose different capabilities. Insight.ts keeps those differences
                        in the typed query instead of hiding them behind a generic dashboard API.
                    </p>
                    <p class="text-muted mt-4 leading-7">
                        Insight.ts derives each Source query and result from the configured Provider
                        while leaving unrelated data in its own shape.
                    </p>
                </div>

                <div class="overflow-hidden rounded-2xl border border-default bg-muted/30">
                    <div class="flex items-center gap-2 border-b border-default px-5 py-3">
                        <span class="size-2 rounded-full bg-muted" />
                        <span class="size-2 rounded-full bg-muted" />
                        <span class="size-2 rounded-full bg-muted" />
                        <span class="text-dimmed ml-2 font-mono text-xs">traffic.ts</span>
                    </div>
                    <pre
                        class="m-0 overflow-x-auto bg-default/70 p-5 font-mono text-sm leading-7 sm:p-7"
                    ><code><span class="text-dimmed">const</span> dashboard = <span class="text-dimmed">await</span> insight.query((q) => ({
    traffic: q.source.cloudflare.webAnalytics({
        metrics: [<span class="text-highlighted">'pageViews'</span>, <span class="text-highlighted">'visits'</span>],
        time: { ...range, grain: <span class="text-highlighted">'day'</span> },
    }),
}))</code></pre>

                    <dl class="divide-y divide-default border-t border-default">
                        <div
                            v-for="item in inferredTypes"
                            :key="item.label"
                            class="grid gap-1 px-5 py-3 sm:grid-cols-[7rem_1fr] sm:items-center sm:px-7"
                        >
                            <dt class="text-dimmed text-xs font-medium tracking-wide uppercase">
                                {{ item.label }}
                            </dt>
                            <dd
                                class="text-highlighted overflow-x-auto font-mono text-xs sm:text-sm"
                            >
                                {{ item.value }}
                            </dd>
                        </div>
                    </dl>
                </div>
            </div>

            <div class="mt-20 grid gap-4 md:grid-cols-3 sm:mt-28">
                <article
                    v-for="principle in principles"
                    :key="principle.title"
                    class="rounded-2xl border border-default p-6 sm:p-7"
                >
                    <UIcon :name="principle.icon" class="text-highlighted size-6" />
                    <h3 class="text-highlighted mt-8 text-xl font-semibold">
                        {{ principle.title }}
                    </h3>
                    <p class="text-muted mt-3 leading-7">
                        {{ principle.description }}
                    </p>
                </article>
            </div>
        </UContainer>
    </section>
</template>
