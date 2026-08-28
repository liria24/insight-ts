<script setup lang="ts">
import type {
    AnalyticsScalarReport,
    AnalyticsSeriesReport,
    AnalyticsTableReport,
} from '@liria24/analytics'
import {
    AnalyticsAreaChart,
    AnalyticsBreakdownTable,
    AnalyticsLineChart,
    AnalyticsStat,
} from '@liria24/analytics/vue/ui'

type ExampleKind = 'area' | 'breakdown' | 'line' | 'stat' | 'styling'

const props = defineProps<{ kind: ExampleKind }>()

const scalarReport: AnalyticsScalarReport = {
    kind: 'scalar',
    meta: {
        quality: {},
        queriedAt: '2026-08-28T09:00:00.000Z',
        source: 'docs.example',
        temporal: {},
    },
    values: { pageViews: 18420, visits: 9320 },
}

const seriesReport: AnalyticsSeriesReport = {
    kind: 'series',
    meta: {
        quality: {},
        queriedAt: '2026-08-28T09:00:00.000Z',
        source: 'docs.example',
        temporal: { bucketTimezone: 'UTC', grain: 'day' },
    },
    points: [
        { time: '2026-08-22T00:00:00.000Z', values: { pageViews: 1240, visits: 710 } },
        { time: '2026-08-23T00:00:00.000Z', values: { pageViews: 1510, visits: 820 } },
        { time: '2026-08-24T00:00:00.000Z', values: { pageViews: 1390, visits: 780 } },
        { time: '2026-08-25T00:00:00.000Z', values: { pageViews: 1760, visits: 960 } },
        { time: '2026-08-26T00:00:00.000Z', values: { pageViews: 2110, visits: 1080 } },
        { time: '2026-08-27T00:00:00.000Z', values: { pageViews: 1980, visits: 1030 } },
        { time: '2026-08-28T00:00:00.000Z', values: { pageViews: 2380, visits: 1210 } },
    ],
}

const tableReport: AnalyticsTableReport = {
    kind: 'table',
    meta: {
        quality: {},
        queriedAt: '2026-08-28T09:00:00.000Z',
        source: 'docs.example',
        temporal: {},
    },
    rows: [
        { dimensions: { country: 'Japan' }, metrics: { pageViews: 8240, visits: 4210 } },
        { dimensions: { country: 'United States' }, metrics: { pageViews: 6190, visits: 3180 } },
        { dimensions: { country: 'Germany' }, metrics: { pageViews: 3990, visits: 1930 } },
    ],
}

const seriesSource = `const report: AnalyticsSeriesReport = {
  kind: 'series',
  meta: {
    quality: {},
    queriedAt: '2026-08-28T09:00:00.000Z',
    source: 'example',
    temporal: { bucketTimezone: 'UTC', grain: 'day' },
  },
  points: [
    { time: '2026-08-22T00:00:00.000Z', values: { pageViews: 1240, visits: 710 } },
    { time: '2026-08-23T00:00:00.000Z', values: { pageViews: 1510, visits: 820 } },
    { time: '2026-08-24T00:00:00.000Z', values: { pageViews: 1390, visits: 780 } },
    { time: '2026-08-25T00:00:00.000Z', values: { pageViews: 1760, visits: 960 } },
    { time: '2026-08-26T00:00:00.000Z', values: { pageViews: 2110, visits: 1080 } },
    { time: '2026-08-27T00:00:00.000Z', values: { pageViews: 1980, visits: 1030 } },
    { time: '2026-08-28T00:00:00.000Z', values: { pageViews: 2380, visits: 1210 } },
  ],
}`

function sfc(script: string, template: string, style = ''): string {
    const result = `<script setup lang="ts">\n${script}\n<${'/script'}>\n\n<template>\n${template}\n<${'/template'}>`
    return style ? `${result}\n\n<style scoped>\n${style}\n<${'/style'}>` : result
}

const examples: Record<ExampleKind, { code: string; title: string }> = {
    stat: {
        title: 'Scalar report',
        code: sfc(
            `import type { AnalyticsScalarReport } from '@liria24/analytics'
import { AnalyticsStat } from '@liria24/analytics/vue/ui'

const report: AnalyticsScalarReport = {
  kind: 'scalar',
  meta: { quality: {}, queriedAt: '2026-08-28T09:00:00.000Z', source: 'example', temporal: {} },
  values: { pageViews: 18420 },
}`,
            `  <AnalyticsStat :report="report" metric="pageViews" />`,
        ),
    },
    line: {
        title: 'Seven-day traffic',
        code: sfc(
            `import type { AnalyticsSeriesReport } from '@liria24/analytics'
import { AnalyticsLineChart } from '@liria24/analytics/vue/ui'

${seriesSource}`,
            `  <AnalyticsLineChart
    :report="report"
    :metrics="['pageViews', 'visits']"
    title="Traffic"
    :height="280"
  />`,
        ),
    },
    area: {
        title: 'Overlaid area series',
        code: sfc(
            `import type { AnalyticsSeriesReport } from '@liria24/analytics'
import { AnalyticsAreaChart } from '@liria24/analytics/vue/ui'

${seriesSource}`,
            `  <AnalyticsAreaChart
    :report="report"
    :metrics="['pageViews', 'visits']"
    title="Traffic"
    smooth
    :height="280"
  />`,
        ),
    },
    breakdown: {
        title: 'Traffic by country',
        code: sfc(
            `import type { AnalyticsTableReport } from '@liria24/analytics'
import { AnalyticsBreakdownTable } from '@liria24/analytics/vue/ui'

const report: AnalyticsTableReport = {
  kind: 'table',
  meta: { quality: {}, queriedAt: '2026-08-28T09:00:00.000Z', source: 'example', temporal: {} },
  rows: [
    { dimensions: { country: 'Japan' }, metrics: { pageViews: 8240, visits: 4210 } },
    { dimensions: { country: 'United States' }, metrics: { pageViews: 6190, visits: 3180 } },
    { dimensions: { country: 'Germany' }, metrics: { pageViews: 3990, visits: 1930 } },
  ],
}`,
            `  <AnalyticsBreakdownTable
    :report="report"
    :dimensions="['country']"
    :metrics="['pageViews', 'visits']"
  />`,
        ),
    },
    styling: {
        title: 'Semantic colors and UI classes',
        code: sfc(
            `import type { AnalyticsSeriesReport } from '@liria24/analytics'
import { AnalyticsAreaChart } from '@liria24/analytics/vue/ui'

${seriesSource}`,
            `  <AnalyticsAreaChart
    class="custom-chart"
    :report="report"
    :metrics="['pageViews', 'visits']"
    title="Traffic"
    :ui="{ title: 'custom-title', legend: 'custom-legend' }"
    :height="280"
  />`,
            `.custom-chart {
  --analytics-chart-1: #0ea5e9;
  --analytics-chart-2: #8b5cf6;
  --analytics-chart-grid: color-mix(in srgb, currentColor 12%, transparent);
}

.custom-title { font-weight: 600; }
.custom-legend { font-size: 0.75rem; }`,
        ),
    },
}

const example = computed(() => examples[props.kind])
</script>

<template>
    <div class="not-prose my-6 overflow-hidden rounded-lg border border-default bg-default">
        <div class="flex items-center justify-between border-b border-default px-4 py-3">
            <span class="text-sm font-medium text-highlighted">{{ example.title }}</span>
            <UBadge color="neutral" label="Live example" size="sm" variant="subtle" />
        </div>

        <div class="p-4 sm:p-6">
            <AnalyticsStat
                v-if="props.kind === 'stat'"
                class="max-w-sm rounded-lg border border-default p-5"
                metric="pageViews"
                :report="scalarReport"
                :ui="{
                    label: 'text-xs font-medium uppercase tracking-wide text-muted',
                    value: 'mt-2 text-3xl font-semibold tabular-nums text-highlighted',
                }"
            />
            <AnalyticsLineChart
                v-else-if="props.kind === 'line'"
                :height="280"
                :metrics="['pageViews', 'visits']"
                :report="seriesReport"
                title="Traffic"
            />
            <AnalyticsAreaChart
                v-else-if="props.kind === 'area'"
                smooth
                :height="280"
                :metrics="['pageViews', 'visits']"
                :report="seriesReport"
                title="Traffic"
            />
            <AnalyticsBreakdownTable
                v-else-if="props.kind === 'breakdown'"
                :dimensions="['country']"
                :metrics="['pageViews', 'visits']"
                :report="tableReport"
            />
            <AnalyticsAreaChart
                v-else
                class="docs-custom-chart"
                :height="280"
                :metrics="['pageViews', 'visits']"
                :report="seriesReport"
                title="Traffic"
                :ui="{
                    legend: 'text-xs',
                    title: 'font-semibold',
                }"
            />
        </div>

        <details open class="border-t border-default bg-muted/30">
            <summary class="cursor-pointer px-4 py-3 text-sm font-medium text-highlighted">
                Reproduction code
            </summary>
            <pre
                class="m-0 overflow-x-auto border-t border-default p-4 text-xs leading-5"
            ><code>{{ example.code }}</code></pre>
        </details>
    </div>
</template>

<style scoped>
.docs-custom-chart {
    --analytics-chart-1: #0ea5e9;
    --analytics-chart-2: #8b5cf6;
    --analytics-chart-grid: color-mix(in srgb, currentColor 12%, transparent);
}
</style>
