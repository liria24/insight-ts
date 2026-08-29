<script setup lang="ts">
defineProps<{ data: DemoReportResponse }>()

const money = new Intl.NumberFormat('en-US', { currency: 'USD', style: 'currency' })
</script>

<template>
    <div class="grid gap-5 lg:grid-cols-2">
        <UCard variant="subtle">
            <h3 class="font-semibold text-highlighted">Funnel</h3>
            <ol class="mt-4 space-y-3">
                <li
                    v-for="step in data.funnel.data.steps"
                    :key="step.name"
                    class="grid grid-cols-[1fr_auto] gap-3"
                >
                    <span>{{ step.name }}</span>
                    <strong class="tabular-nums"
                        >{{ step.converted.toLocaleString() }} ·
                        {{ Math.round(step.rate * 100) }}%</strong
                    >
                    <span class="col-span-2 h-1.5 overflow-hidden rounded-full bg-muted"
                        ><span
                            class="block h-full bg-primary"
                            :style="{ width: `${step.rate * 100}%` }"
                    /></span>
                </li>
            </ol>
        </UCard>

        <UCard variant="subtle">
            <h3 class="font-semibold text-highlighted">Paginated logs</h3>
            <ul class="mt-4 divide-y divide-default font-mono text-xs">
                <li
                    v-for="entry in data.logs.data.entries"
                    :key="entry.timestamp"
                    class="grid grid-cols-[auto_1fr] gap-3 py-3"
                >
                    <UBadge
                        :color="
                            entry.level === 'error'
                                ? 'error'
                                : entry.level === 'warn'
                                  ? 'warning'
                                  : 'neutral'
                        "
                        variant="subtle"
                        >{{ entry.level }}</UBadge
                    >
                    <span
                        ><time class="text-muted">{{ entry.timestamp }}</time
                        ><br />{{ entry.message }}</span
                    >
                </li>
            </ul>
            <p class="mt-3 text-xs text-muted">nextCursor: {{ data.logs.meta.nextCursor }}</p>
        </UCard>

        <UCard variant="subtle">
            <h3 class="font-semibold text-highlighted">Trace graph</h3>
            <p class="mt-1 truncate font-mono text-xs text-muted">{{ data.trace.data.traceId }}</p>
            <ul class="mt-4 space-y-2">
                <li
                    v-for="span in data.trace.data.spans"
                    :key="span.id"
                    class="flex justify-between gap-4 rounded-md border border-default p-3"
                    :class="span.parentId ? 'ml-5' : ''"
                >
                    <span>{{ span.name }}</span
                    ><strong class="tabular-nums">{{ span.durationMs }}ms</strong>
                </li>
            </ul>
        </UCard>

        <UCard variant="subtle">
            <h3 class="font-semibold text-highlighted">Billing domain data</h3>
            <div class="mt-4 flex justify-between">
                <span>Revenue</span><strong>{{ money.format(data.billing.data.revenue) }}</strong>
            </div>
            <div class="mt-2 flex justify-between">
                <span>Outstanding</span
                ><strong>{{ money.format(data.billing.data.outstanding) }}</strong>
            </div>
            <ul class="mt-4 divide-y divide-default text-sm">
                <li
                    v-for="invoice in data.billing.data.invoices"
                    :key="invoice.customer"
                    class="flex justify-between gap-4 py-2"
                >
                    <span>{{ invoice.customer }} · {{ invoice.status }}</span
                    ><span class="tabular-nums">{{ money.format(invoice.amount) }}</span>
                </li>
            </ul>
        </UCard>
    </div>
</template>
