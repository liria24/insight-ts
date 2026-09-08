<script setup lang="ts">
const { copied, copy } = useClipboard()

type packageManager = 'npm' | 'pnpm' | 'bun' | 'yarn'
const packageManagers: Record<packageManager, { label: string; icon: string; install: string }> = {
    npm: { label: 'npm', icon: 'simple-icons:npm', install: 'npm i' },
    pnpm: { label: 'pnpm', icon: 'simple-icons:pnpm', install: 'pnpm add' },
    bun: { label: 'Bun', icon: 'simple-icons:bun', install: 'bun add' },
    yarn: { label: 'yarn', icon: 'simple-icons:yarn', install: 'yarn add' },
}
const selectPM = ref<packageManager>('npm')
const displayCommand = computed(() => `${packageManagers[selectPM.value].install} insight-ts`)

const ecosystem = [
    {
        name: 'Cloudflare',
        icon: 'simple-icons:cloudflare',
        kind: 'Web Analytics, Analytics Engine',
    },
    { name: 'Search Console', icon: 'simple-icons:google', kind: 'Search Metrics' },
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
                    <div class="relative group">
                        <UButton
                            :label="displayCommand"
                            :trailing-icon="copied ? 'mingcute:check-line' : 'mingcute:copy-2-line'"
                            variant="outline"
                            color="neutral"
                            size="xl"
                            :ui="{
                                label: 'text-ellipsis [text-box:trim-both_cap_alphabetic]',
                                trailingIcon: 'size-4.5',
                            }"
                            class="rounded-full px-6 py-3 font-mono"
                            @click="copy(displayCommand)"
                        />

                        <div
                            class="absolute inset-x-0 pt-2 opacity-0 group-hover:opacity-100 transition-opacity"
                        >
                            <UButton
                                v-for="(pm, key) in packageManagers"
                                :icon="pm.icon"
                                variant="link"
                                color="neutral"
                                @click="selectPM = key"
                            />
                        </div>
                    </div>

                    <UButton
                        to="/getting-started/introduction"
                        label="Read the docs"
                        trailing-icon="mingcute:arrow-right-line"
                        color="neutral"
                        size="xl"
                        :ui="{
                            label: 'text-ellipsis [text-box:trim-both_cap_alphabetic]',
                            trailingIcon: 'size-4.5',
                        }"
                        class="rounded-full px-6 py-3"
                    />
                </div>
            </div>
        </UContainer>

        <div class="border-t border-default">
            <UContainer class="py-8 sm:py-10">
                <p
                    class="text-dimmed mb-6 text-center text-xs font-medium tracking-[0.2em] uppercase"
                >
                    Providers
                </p>
                <ul aria-label="Supported Providers" class="grid grid-cols-2 gap-x-4 gap-y-6">
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
