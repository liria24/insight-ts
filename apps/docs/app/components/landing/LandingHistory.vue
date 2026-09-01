<script setup lang="ts">
const features = [
    {
        title: 'History',
        description: 'Backfill Source-declared Metric ranges and keep any reduction visible.',
    },
    {
        title: 'Events',
        description:
            'Validate application events while Providers retain their native transport behavior.',
    },
    {
        title: 'UI',
        description:
            'Render existing Metric results without coupling charts to Providers or History.',
    },
]
</script>

<template>
    <section class="py-20 sm:py-28">
        <UContainer>
            <div class="grid gap-12 lg:grid-cols-2 lg:items-start lg:gap-20">
                <div>
                    <p class="text-dimmed text-sm font-medium tracking-wide uppercase">
                        Optional features
                    </p>
                    <h2
                        class="text-highlighted mt-4 text-4xl leading-tight font-semibold tracking-tight text-balance sm:text-5xl"
                    >
                        Add History, events, and UI when your product needs them.
                    </h2>
                    <p class="text-muted mt-6 text-lg leading-8">
                        History backfills Source-declared Metric ranges. Events and UI remain
                        optional, so the core query path stays focused on the data your application
                        needs.
                    </p>

                    <pre
                        class="mt-8 overflow-x-auto rounded-2xl border border-default bg-muted/30 p-5 font-mono text-sm leading-7 sm:p-7"
                    ><code><span class="text-dimmed">await</span> insight.history.sync({ range })</code></pre>

                    <p class="text-dimmed mt-4 text-sm">
                        History repositories stay small: `coverage`, `read`, and `write`.
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
                        to="/get-started/overview/first-query"
                        label="Build your first query"
                        trailing-icon="mingcute:arrow-right-line"
                        color="neutral"
                        size="lg"
                        class="rounded-full"
                    />
                    <UButton
                        to="/get-started/query/introduction"
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
