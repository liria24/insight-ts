<script setup lang="ts">
const { copied, copy } = useClipboard()

const installCommand = 'bun add insight-ts'
const ecosystem = [
    { name: 'Cloudflare', icon: 'simple-icons:cloudflare', kind: 'Provider' },
    { name: 'Search Console', icon: 'simple-icons:google', kind: 'Provider' },
    { name: 'Nitro', icon: 'mingcute:server-2-line', kind: 'Runtime' },
    { name: 'Nuxt', icon: 'simple-icons:nuxt', kind: 'Framework' },
    { name: 'Browser', icon: 'mingcute:earth-2-line', kind: 'Client' },
    { name: 'Vue', icon: 'simple-icons:vuedotjs', kind: 'UI' },
]
</script>

<template>
    <section class="border-b border-default">
        <UContainer class="py-20 sm:py-28 lg:py-36">
            <div class="mx-auto max-w-5xl text-center">
                <UBadge
                    color="neutral"
                    label="Runtime-neutral TypeScript SDK"
                    size="lg"
                    variant="subtle"
                    class="rounded-full px-4"
                />

                <h1
                    class="text-highlighted mx-auto mt-7 max-w-5xl text-5xl leading-[1.02] font-semibold tracking-[-0.045em] text-balance sm:text-7xl lg:text-8xl"
                >
                    Typed queries for the data your product already uses.
                </h1>

                <p
                    class="text-muted mx-auto mt-7 max-w-3xl text-lg leading-8 text-pretty sm:text-xl"
                >
                    Insight.ts is a TypeScript SDK for querying analytics, observability, and
                    application data. Each Provider keeps its own metrics, limits, and metadata.
                </p>

                <div class="mt-10 flex flex-col items-center justify-center gap-3 sm:flex-row">
                    <UButton
                        :label="installCommand"
                        :trailing-icon="copied ? 'mingcute:check-line' : 'mingcute:copy-2-line'"
                        variant="outline"
                        color="neutral"
                        size="xl"
                        :ui="{ label: 'leading-none', trailingIcon: 'size-4.5' }"
                        class="rounded-full px-5 font-mono"
                        @click="copy(installCommand)"
                    />
                    <UButton
                        to="/getting-started/introduction"
                        label="Read the docs"
                        trailing-icon="mingcute:arrow-right-line"
                        color="neutral"
                        size="xl"
                        :ui="{ label: 'leading-none', trailingIcon: 'size-4.5' }"
                        class="rounded-full px-5"
                    />
                </div>

                <p class="text-dimmed mt-5 text-sm">
                    Start with one Source. Add Providers, History, events, runtimes, and UI only
                    when you need them.
                </p>
            </div>
        </UContainer>

        <div class="border-t border-default">
            <UContainer class="py-8 sm:py-10">
                <p
                    class="text-dimmed mb-6 text-center text-xs font-medium tracking-[0.2em] uppercase"
                >
                    Providers and integrations
                </p>
                <ul
                    aria-label="Supported Providers and integrations"
                    class="grid grid-cols-2 gap-x-4 gap-y-6 sm:grid-cols-3 lg:grid-cols-6"
                >
                    <li
                        v-for="item in ecosystem"
                        :key="item.name"
                        class="flex items-center justify-center gap-3"
                    >
                        <UIcon :name="item.icon" class="text-highlighted size-5 shrink-0" />
                        <span class="min-w-0">
                            <span class="text-highlighted block truncate text-sm font-medium">
                                {{ item.name }}
                            </span>
                            <span class="text-dimmed block text-xs">{{ item.kind }}</span>
                        </span>
                    </li>
                </ul>
            </UContainer>
        </div>
    </section>
</template>
