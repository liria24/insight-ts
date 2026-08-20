<script setup lang="ts">
useAnalytics().track('pageViewed', { path: '/fixture' })

const report = {
    kind: 'series' as const,
    meta: {
        quality: {},
        queriedAt: '2026-08-20T00:00:00.000Z',
        source: 'fixture',
        temporal: { bucketTimezone: 'UTC', grain: 'day' as const },
    },
    points: [
        { time: '2026-08-19T00:00:00.000Z', values: { visits: 12 } },
        { time: '2026-08-20T00:00:00.000Z', values: { visits: 18 } },
    ],
}
</script>

<template>
    <main>
        <p>Nuxt analytics fixture</p>
        <AnalyticsDashboard :report="report" />
    </main>
</template>
