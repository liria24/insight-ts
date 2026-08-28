<script setup lang="ts">
const { copied, copy } = useClipboard()

const installCommand = 'npm i insight-ts'

const cards = ref([
    {
        title: 'Cloudflare',
        description: 'Web Analytics and Analytics Engine',
        icon: 'simple-icons:cloudflare',
        to: '/providers/cloudflare',
    },
    {
        title: 'Google Search Console',
        icon: 'simple-icons:google',
        to: '/providers/google-search-console',
    },
])

useHead({ titleTemplate: '%s' })
</script>

<template>
    <UContainer>
        <UPageHero
            title="Insight.ts"
            description="Typed Provider capabilities, History, and optional runtime/UI integrations for server-side TypeScript applications."
        >
            <template #links>
                <UButton
                    :label="installCommand"
                    :trailing-icon="copied ? 'mingcute:check-line' : 'mingcute:copy-2-fill'"
                    variant="outline"
                    color="neutral"
                    size="lg"
                    :ui="{ trailingIcon: 'size-4 text-toned' }"
                    class="rounded-full pl-5 pr-4 font-mono"
                    @click="copy(installCommand)"
                />
                <UButton
                    to="/getting-started/introduction"
                    label="Read the docs"
                    trailing-icon="mingcute:arrow-right-line"
                    variant="ghost"
                    color="neutral"
                    size="lg"
                    class="rounded-full pl-5 pr-4"
                />
            </template>
        </UPageHero>

        <UPageCTA title="Providers" variant="naked">
            <UPageGrid>
                <UPageCard v-for="(card, index) in cards" :key="index" v-bind="card" />
            </UPageGrid>
        </UPageCTA>
    </UContainer>
</template>
