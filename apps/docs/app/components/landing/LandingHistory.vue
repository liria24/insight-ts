<script setup lang="ts">
const features = [
    {
        title: 'Missing-range backfill',
        description:
            'Fetch only uncovered or provisional intervals, then compose History and live data.',
    },
    {
        title: 'Normal execution path',
        description:
            'Fetch History gaps through the same multi-Source execution primitive as live queries.',
    },
    {
        title: 'Idempotent writes',
        description: 'Deterministic segment identity makes repeated sync work safe to retry.',
    },
    {
        title: 'Fidelity metadata',
        description:
            'Keep lossy reduction visible and separate from Provider Quality across the requested range.',
    },
]
</script>

<template>
    <section class="py-20 sm:py-28">
        <UContainer>
            <div class="grid gap-12 lg:grid-cols-2 lg:items-start lg:gap-20">
                <div>
                    <p class="text-dimmed text-sm font-medium tracking-wide uppercase">History</p>
                    <h2
                        class="text-highlighted mt-4 text-4xl leading-tight font-semibold tracking-tight text-balance sm:text-5xl"
                    >
                        Materialize history. Do not hide it behind a cache.
                    </h2>
                    <p class="text-muted mt-6 text-lg leading-8">
                        Providers own query and safe rollup semantics. The History Engine owns gaps,
                        fetches, composition, reduction, Fidelity, and segment identity.
                    </p>

                    <pre
                        class="mt-8 overflow-x-auto rounded-2xl border border-default bg-muted/30 p-5 font-mono text-sm leading-7 sm:p-7"
                    ><code><span class="text-dimmed">await</span> insight.history.sync({ range })</code></pre>

                    <p class="text-dimmed mt-4 text-sm">
                        Repositories stay small: `coverage`, `read`, and `write`.
                    </p>
                </div>

                <div class="grid gap-3 sm:grid-cols-2">
                    <article
                        v-for="(feature, index) in features"
                        :key="feature.title"
                        class="rounded-2xl border border-default p-6"
                    >
                        <span class="text-dimmed font-mono text-xs">0{{ index + 1 }}</span>
                        <h3 class="text-highlighted mt-8 text-lg font-semibold">
                            {{ feature.title }}
                        </h3>
                        <p class="text-muted mt-3 text-sm leading-6">
                            {{ feature.description }}
                        </p>
                    </article>
                </div>
            </div>

            <div
                class="mt-20 flex flex-col gap-6 rounded-3xl border border-default bg-muted/30 p-7 sm:mt-28 sm:flex-row sm:items-center sm:justify-between sm:p-10"
            >
                <div>
                    <p class="text-highlighted text-2xl font-semibold tracking-tight sm:text-3xl">
                        Start with one typed Source.
                    </p>
                    <p class="text-muted mt-2">
                        Add Providers, History, and UI only where the application needs them.
                    </p>
                </div>
                <div class="flex shrink-0 flex-wrap gap-3">
                    <UButton
                        to="/getting-started/first-query"
                        label="Build your first query"
                        trailing-icon="mingcute:arrow-right-line"
                        color="neutral"
                        size="lg"
                        class="rounded-full"
                    />
                    <UButton
                        to="/concepts/overview"
                        label="Read the concepts"
                        variant="outline"
                        color="neutral"
                        size="lg"
                        class="rounded-full"
                    />
                </div>
            </div>
        </UContainer>
    </section>
</template>
