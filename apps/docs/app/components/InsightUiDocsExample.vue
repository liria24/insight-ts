<script setup lang="ts">
import type { MetricQueryResult } from 'insight-ts/ui-core'
import {
    InsightAreaChart,
    InsightBreakdownTable,
    InsightLineChart,
    InsightStat,
} from 'insight-ts/vue/ui'

type ExampleKind = 'area' | 'breakdown' | 'line' | 'stat' | 'styling'

const props = defineProps<{ kind: ExampleKind }>()
const meta = {
    queriedAt: '2026-08-28T09:00:00.000Z',
    source: 'docs.example',
    temporal: { bucketTimezone: 'UTC', grain: 'day' as const },
}
const summaryData: MetricQueryResult<'pageViews' | 'visits'> = {
    data: { pageViews: { value: 18_420 }, visits: { value: 9_320 } },
    meta,
}
const times = [
    '2026-08-22T00:00:00.000Z',
    '2026-08-23T00:00:00.000Z',
    '2026-08-24T00:00:00.000Z',
    '2026-08-25T00:00:00.000Z',
    '2026-08-26T00:00:00.000Z',
    '2026-08-27T00:00:00.000Z',
    '2026-08-28T00:00:00.000Z',
]
const pageViews = [1240, 1510, 1390, 1760, 2110, 1980, 2380]
const visits = [710, 820, 780, 960, 1080, 1030, 1210]
const seriesData: MetricQueryResult<'pageViews' | 'visits'> = {
    data: {
        pageViews: {
            points: times.map((time, index) => ({ time, value: pageViews[index]! })),
            value: 12_370,
        },
        visits: {
            points: times.map((time, index) => ({ time, value: visits[index]! })),
            value: 6_590,
        },
    },
    meta,
}
const breakdownData: MetricQueryResult<'pageViews' | 'visits', 'country'> = {
    data: {
        pageViews: {
            points: [
                { dimensions: { country: 'Japan' }, value: 8240 },
                { dimensions: { country: 'United States' }, value: 6190 },
                { dimensions: { country: 'Germany' }, value: 3990 },
            ],
            value: 18_420,
        },
        visits: {
            points: [
                { dimensions: { country: 'Japan' }, value: 4210 },
                { dimensions: { country: 'United States' }, value: 3180 },
                { dimensions: { country: 'Germany' }, value: 1930 },
            ],
            value: 9_320,
        },
    },
    meta,
}

const metricDataSource = `import type { MetricQueryResult } from 'insight-ts/ui-core'

const data: MetricQueryResult<'pageViews' | 'visits'> = {
  data: {
    pageViews: {
      value: 2750,
      points: [
        { time: '2026-08-27T00:00:00.000Z', value: 1240 },
        { time: '2026-08-28T00:00:00.000Z', value: 1510 },
      ],
    },
    visits: {
      value: 1530,
      points: [
        { time: '2026-08-27T00:00:00.000Z', value: 710 },
        { time: '2026-08-28T00:00:00.000Z', value: 820 },
      ],
    },
  },
  meta: { queriedAt: '2026-08-28T09:00:00.000Z', source: 'example' },
}`

function sfc(script: string, template: string, style = ''): string {
    const result = `<script setup lang="ts">\n${script}\n<${'/script'}>\n\n<template>\n${template}\n<${'/template'}>`
    return style ? `${result}\n\n<style scoped>\n${style}\n<${'/style'}>` : result
}

const examples: Record<ExampleKind, { code: string; title: string }> = {
    stat: {
        title: 'Metric value',
        code: sfc(
            `import { InsightStat } from 'insight-ts/vue/ui'\n\n${metricDataSource}`,
            `  <InsightStat :data="data" metric="pageViews" />`,
        ),
    },
    line: {
        title: 'Selected metrics in Source order',
        code: sfc(
            `import { InsightLineChart } from 'insight-ts/vue/ui'\n\n${metricDataSource}`,
            `  <InsightLineChart :data="data" title="Traffic" :height="280" />`,
        ),
    },
    area: {
        title: 'Overlaid area series',
        code: sfc(
            `import { InsightAreaChart } from 'insight-ts/vue/ui'\n\n${metricDataSource}`,
            `  <InsightAreaChart :data="data" title="Traffic" smooth :height="280" />`,
        ),
    },
    breakdown: {
        title: 'Selected dimensions and metrics',
        code: sfc(
            `import { InsightBreakdownTable } from 'insight-ts/vue/ui'\n\n${metricDataSource}`,
            `  <InsightBreakdownTable :data="data" />`,
        ),
    },
    styling: {
        title: 'Semantic colors and UI classes',
        code: sfc(
            `import { InsightAreaChart } from 'insight-ts/vue/ui'\n\n${metricDataSource}`,
            `  <InsightAreaChart class="custom-chart" :data="data" title="Traffic" :ui="{ title: 'custom-title' }" />`,
            `.custom-chart { --insight-chart-1: #0ea5e9; --insight-chart-2: #8b5cf6; }`,
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
            <InsightStat
                v-if="props.kind === 'stat'"
                class="max-w-sm rounded-lg border border-default p-5"
                :data="summaryData"
                metric="pageViews"
            />
            <InsightLineChart
                v-else-if="props.kind === 'line'"
                :data="seriesData"
                :height="280"
                title="Traffic"
            />
            <InsightAreaChart
                v-else-if="props.kind === 'area'"
                :data="seriesData"
                :height="280"
                smooth
                title="Traffic"
            />
            <InsightBreakdownTable v-else-if="props.kind === 'breakdown'" :data="breakdownData" />
            <InsightAreaChart
                v-else
                class="docs-custom-chart"
                :data="seriesData"
                :height="280"
                title="Traffic"
                :ui="{ legend: 'text-xs', title: 'font-semibold' }"
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
    --insight-chart-1: #0ea5e9;
    --insight-chart-2: #8b5cf6;
}
</style>
