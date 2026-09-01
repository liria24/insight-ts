<script setup lang="ts">
const props = defineProps<{ white?: boolean }>()

const color = computed(() => (props.white ? 'text-white' : 'text-highlighted hover:text-default'))
</script>

<template>
    <div class="flex items-center gap-6">
        <ULink
            to="/"
            aria-label="Insight.ts home"
            class="text-lg font-semibold tracking-tight transition-colors"
            :class="color"
        >
            Insight.ts
        </ULink>

        <UNavigationMenu
            color="neutral"
            variant="link"
            :items="[
                {
                    label: 'Docs',
                    to: '/get-started/overview/introduction',
                },
                {
                    label: 'Demo',
                    to: '/demo',
                },
            ]"
        />
    </div>
</template>
