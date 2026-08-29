<script setup lang="ts">
const connections = [
    {
        from: 'Providers',
        to: 'Core',
        description: 'Translate native requests into typed reports without hiding Provider facts.',
    },
    {
        from: 'History',
        to: 'Core',
        description: 'Uses Source-owned schema, range, rollup, freshness, and report semantics.',
    },
    {
        from: 'Nitro',
        to: 'Nuxt',
        description: 'Nuxt composes Nitro-owned storage and opt-in task wiring.',
    },
    {
        from: 'Browser',
        to: 'Vue',
        description: 'Vue provides the standalone browser event client without server access.',
    },
    {
        from: 'UI Core',
        to: 'Vue UI',
        description: 'Vue UI renders framework-neutral models with a private chart renderer.',
    },
]

const entrypoints = [
    { name: 'Core', path: 'insight-ts', icon: 'mingcute:hexagon-line' },
    { name: 'Nitro', path: 'insight-ts/nitro', icon: 'mingcute:server-2-line' },
    { name: 'Nuxt', path: 'insight-ts/nuxt', icon: 'simple-icons:nuxt' },
    { name: 'Browser', path: 'insight-ts/browser', icon: 'mingcute:earth-2-line' },
    { name: 'UI Core', path: 'insight-ts/ui-core', icon: 'mingcute:layout-4-line' },
    { name: 'Vue UI', path: 'insight-ts/vue/ui', icon: 'simple-icons:vuedotjs' },
]
</script>

<template>
    <section class="border-b border-default py-20 sm:py-28">
        <UContainer>
            <div class="mx-auto max-w-3xl text-center">
                <p class="text-dimmed text-sm font-medium tracking-wide uppercase">Ecosystem</p>
                <h2
                    class="text-highlighted mt-4 text-4xl leading-tight font-semibold tracking-tight text-balance sm:text-5xl"
                >
                    Integrations connect. Core stays small.
                </h2>
                <p class="text-muted mt-6 text-lg leading-8">
                    There is no mandatory adapter stack. Each entrypoint depends only on the layers
                    it connects, so runtime and framework choices remain independent.
                </p>
            </div>

            <div class="mt-14 grid gap-5 lg:grid-cols-[0.8fr_1.2fr]">
                <div class="grid grid-cols-2 gap-3 sm:grid-cols-3 lg:grid-cols-2">
                    <div
                        v-for="entrypoint in entrypoints"
                        :key="entrypoint.name"
                        class="rounded-xl border border-default p-4"
                    >
                        <div class="flex items-center gap-3">
                            <UIcon :name="entrypoint.icon" class="text-highlighted size-5" />
                            <span class="text-highlighted font-medium">{{ entrypoint.name }}</span>
                        </div>
                        <code class="text-dimmed mt-3 block overflow-x-auto text-xs">
                            {{ entrypoint.path }}
                        </code>
                    </div>
                </div>

                <div class="overflow-hidden rounded-2xl border border-default">
                    <div
                        v-for="(connection, index) in connections"
                        :key="connection.from"
                        class="grid gap-3 p-5 sm:grid-cols-[12rem_1fr] sm:items-center sm:p-6"
                        :class="index > 0 ? 'border-t border-default' : ''"
                    >
                        <div class="flex items-center gap-2 font-mono text-sm">
                            <span class="text-highlighted rounded-md bg-muted px-2.5 py-1.5">
                                {{ connection.from }}
                            </span>
                            <UIcon name="mingcute:arrow-right-line" class="text-dimmed size-4" />
                            <span class="text-highlighted rounded-md bg-muted px-2.5 py-1.5">
                                {{ connection.to }}
                            </span>
                        </div>
                        <p class="text-muted text-sm leading-6">
                            {{ connection.description }}
                        </p>
                    </div>
                </div>
            </div>
        </UContainer>
    </section>
</template>
