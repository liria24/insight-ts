# Insight.ts

> A runtime-neutral TypeScript SDK for analytics, observability, and application data.

[![Runtime neutral](https://shieldcn.dev/badge/runtime-neutral-TypeScript-18181b.svg?variant=outline)](https://insight.liria.me/getting-started/introduction)
[![Provider native](https://shieldcn.dev/badge/provider-semantics-18181b.svg?variant=outline)](https://insight.liria.me/concepts/overview)
[![License](https://shieldcn.dev/badge/license-MIT-18181b.svg?variant=outline)](https://spdx.org/licenses/MIT.html)

<!-- Add the npm badge and link it to npmx after the first public release. -->

Analytics providers do not agree on metrics, query shapes, or operations. Flattening them into one
universal interface hides the differences your application still has to handle.

Insight.ts keeps those differences typed. Each Provider exposes generic Sources with their own
query and result contracts; Core coordinates them without inventing one universal data model.

The result is a small, composable SDK: use Core alone, or add Providers, History, Nitro, Nuxt,
browser events, UI Core, and Vue UI as your application needs them.

## Quick Start

```sh
bun add insight-ts
```

```ts
import { createInsight } from 'insight-ts'
import { cloudflareWebAnalytics } from 'insight-ts/cloudflare'
import { defineProvider } from 'insight-ts/provider'

const cloudflare = defineProvider({
    id: 'cloudflare',
    sources: {
        webAnalytics: cloudflareWebAnalytics({ accountId, apiToken, siteTag }),
    },
})

const insight = createInsight({ providers: [cloudflare] as const })
const dashboard = await insight.query((q) => ({
    traffic: q.source('cloudflare.webAnalytics', {
        metrics: ['pageViews', 'visits'],
        time: {
            from: '2026-08-01T00:00:00.000Z',
            grain: 'day',
            to: '2026-09-01T00:00:00.000Z',
        },
    }),
}))
```

The Source ID, query, selected metric/dimension keys, result data, and metadata remain typed.

## Features

### Provider semantics stay visible

A shared vocabulary should not imply universal support. Insight.ts validates the requested metric,
dimension, filter, grain, range, and provider limit before network I/O, while preserving sampling,
approximation, freshness, partial-result, and warning metadata in `QueryResult`.

### Typed end to end

Providers declare Sources once. TypeScript carries each Source's query and result through one lazy
`insight.query()` selection. Unsupported Source IDs, metrics, dimensions, filters, and values fail
where they are written.

### Optional by design

Core imports no Provider implementation, History engine, framework, renderer, or runtime package.
Focused entrypoints keep unused Providers, integrations, UI, CSS, and chart code outside your
runtime graph.

## Providers

| Provider                    | Implemented capability                               | Native semantics retained                                        |
| --------------------------- | ---------------------------------------------------- | ---------------------------------------------------------------- |
| Cloudflare Web Analytics    | Metric Source for page views, visits, and breakdowns | Sampling, approximation, partial results, and freshness          |
| Cloudflare Analytics Engine | Metric Source, event destination, or both            | Dataset/binding configuration and sample interval                |
| Google Search Console       | Search Analytics Metric Source                       | Pagination, data state, provider limits, and Pacific boundaries  |
| Application-defined         | Any `defineSource()` query/result contract           | Domain schema, validation, metadata, and optional Metric History |

Providers are Source collections, not mandatory adapters. Analytics, logs, traces, funnels, and
billing can coexist without a Core Source-kind union.

## Integrations

Integrations connect Insight.ts to a host; they do not redefine Core semantics.

| Entrypoint                 | Connects                                                                 |
| -------------------------- | ------------------------------------------------------------------------ |
| `insight-ts/nitro`         | History repositories to Nitro Storage and opt-in Nitro Tasks             |
| `insight-ts/nuxt`          | Provider configuration and server access to Core, composed through Nitro |
| `insight-ts/browser`       | Same-origin, bounded, best-effort event delivery                         |
| `insight-ts/vue`           | Browser Insight to Vue provide/inject                                    |
| `insight-ts/metrics`       | Structured Metric semantics and typed `where` DSL                        |
| `insight-ts/opentelemetry` | Optional adapter from Core instrumentation to host OTel APIs             |
| `insight-ts/ui-core`       | Metric results to framework- and renderer-independent UI models          |
| `insight-ts/vue/ui`        | UI Core models to optional Vue Metric components and a private renderer  |

Nitro is not treated as H3, and Nuxt composes the Nitro integration instead of rebuilding its
storage or task behavior.

## History

Provider retention is finite. Metric History materializes declared ranges without turning storage
into an opaque result cache.

```ts
import { createHistory } from 'insight-ts/history'

const insight = createInsight({
    providers,
    history: createHistory({ repository, sources: ['cloudflare.webAnalytics'] }),
})

await insight.history.sync({ range }) // backfill missing or provisional intervals
```

The engine owns range slicing, safe rollup, live/History composition, reductions, Fidelity, and
idempotent segment identity. A repository only implements `coverage`, `read`, and `write`.
Non-additive values are rejected rather than silently summed, and lossy reduction remains visible
as range-scoped Fidelity metadata.

## UI

Metric components accept `data`; they never query Providers, handle credentials, cache results, or
run History work.

```vue
<script setup lang="ts">
import { InsightAreaChart, InsightStat } from 'insight-ts/vue/ui'
</script>

<template>
    <InsightStat :data="dashboard.pageViews" />
    <InsightAreaChart :data="dashboard.trafficSeries" />
</template>
```

`insight-ts/ui-core` owns semantic models and formatting. `insight-ts/vue/ui` alone loads Vue UI
components, base CSS, and the private TanStack Charts renderer.

## Documentation

- [Introduction](https://insight.liria.me/getting-started/introduction)
- [First query](https://insight.liria.me/getting-started/first-query)
- [Providers](https://insight.liria.me/providers/cloudflare)
- [History](https://insight.liria.me/guides/history)
- [Live demo](https://insight.liria.me/demo)
- [API entrypoints](https://insight.liria.me/reference/api)

## Development

This repository is a Bun workspace containing the SDK and its English Docus site.

```sh
bun ci
bun run check
bun run docs:dev
```

- `packages/insight-ts` — package source and tests
- `apps/docs` — documentation and product site
- `docs/architecture` — invariants and accepted architecture decisions

Add dependencies with `bun add` from the workspace that owns them.

## License

[MIT](./LICENSE)
