<script setup lang="ts">
const props = defineProps<{ white?: boolean }>()

const color = computed(() => (props.white ? 'text-white' : 'text-highlighted hover:text-default'))
</script>

<template>
    <ULink
        to="/"
        aria-label="Insight.ts home"
        class="text-lg font-semibold tracking-tight transition-colors"
        :class="color"
    >
        Insight.ts
    </ULink>
</template>
