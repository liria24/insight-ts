<script setup lang="ts">
const props = defineProps<{ white?: boolean }>()

const color = computed(() => (props.white ? 'text-white' : 'text-highlighted hover:text-default'))
</script>

<template>
    <div class="flex items-center gap-3">
        <ULink
            to="/"
            aria-label="Insight.ts home"
            class="text-lg font-semibold tracking-tight transition-colors"
            :class="color"
        >
            Insight.ts
        </ULink>

        <ULink to="/getting-started/introduction" class="ml-2 text-sm">Docs</ULink>
        <ULink to="/demo" class="text-sm">Demo</ULink>
    </div>
</template>
