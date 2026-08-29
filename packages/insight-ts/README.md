# Insight.ts

> A runtime-neutral TypeScript SDK for analytics, observability, and application data.

[![Runtime neutral](https://shieldcn.dev/badge/runtime-neutral-TypeScript-18181b.svg?variant=outline)](https://insight.liria.me/getting-started/introduction)
[![Provider native](https://shieldcn.dev/badge/provider-semantics-18181b.svg?variant=outline)](https://insight.liria.me/concepts/overview)
[![License](https://shieldcn.dev/badge/license-MIT-18181b.svg?variant=outline)](https://spdx.org/licenses/MIT.html)

<!-- Add the npm badge and link it to npmx after the first public release. -->

Insight.ts executes typed, Source-owned queries without forcing analytics, observability, product,
or billing data into one result ontology. Core only coordinates Providers and generic Sources;
Metric semantics are an optional helper layer.

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
        where: { country: { in: ['JP', 'US'] } },
    }),
}))
```

The Source ID, query, selected metric/dimension keys, Source-owned data, and metadata stay typed.

## Features

### Provider-native

Each Source owns its query. Provider implementations validate native capability before network I/O
and preserve cross-cutting Quality plus Source-specific metadata.

### Typed end to end

Literal Source, Metric, dimension, filter, and event keys flow through one lazy `insight.query()`
selection without a generated schema step.

### Optional by design

Core stays independent. Providers, History, Nitro, Nuxt, browser delivery, UI Core, and Vue UI are
focused entrypoints, so an unused integration does not become a runtime dependency.

## Providers

Built-in Providers currently cover:

- Cloudflare Web Analytics — page views, visits, supported breakdowns, and sampling quality
- Cloudflare Analytics Engine — a Metric Source, event destination, or both
- Google Search Console — typed Search Analytics metrics with native pagination and limits

Use `defineProvider()` for application or service-specific capabilities. Custom Providers keep the
same source inference, validation, metadata, and History contracts as built-ins.

## Integrations

| Entrypoint                 | Purpose                                                         |
| -------------------------- | --------------------------------------------------------------- |
| `insight-ts/nitro`         | Nitro Storage repository and opt-in History Tasks bridge        |
| `insight-ts/nuxt`          | Provider configuration, server access, and Nitro composition    |
| `insight-ts/browser`       | Same-origin, bounded browser event client                       |
| `insight-ts/vue`           | Vue provide/inject for browser Insight                          |
| `insight-ts/metrics`       | Structured Metric semantics and typed object filters            |
| `insight-ts/opentelemetry` | Optional Core instrumentation adapter for host OTel APIs        |
| `insight-ts/ui-core`       | Framework- and renderer-independent Metric result models        |
| `insight-ts/vue/ui`        | Optional Vue Metric components, CSS, and private chart renderer |

Each integration depends only on the layers it connects. Nuxt composes Nitro; Vue UI consumes UI
Core; neither path is pulled into Core.

## History

```ts
import { createHistory } from 'insight-ts/history'

const insight = createInsight({
    providers,
    history: createHistory({ repository, sources: ['cloudflare.webAnalytics'] }),
})

await insight.history.sync({ range })
```

Metric Sources backfill missing or provisional intervals through normal query execution. Segment
writes are idempotent, unsafe non-additive rollups fail, and lossy reductions remain visible as
Fidelity metadata. Repositories only implement `coverage`, `read`, and `write`.

## UI

```ts
import { InsightAreaChart, InsightLineChart, InsightStat } from 'insight-ts/vue/ui'
```

Components render existing Metric QueryResults through a `data` prop and never perform Provider
I/O, caching, History work, or auth. Line and area charts draw every selected metric in Source
order; selection props remain only where presentation needs one metric or dimension.
Importing `insight-ts/vue/ui` loads its base CSS and private TanStack Charts renderer; other
entrypoints do not.

## Documentation

Read the [documentation](https://insight.liria.me), follow the
[first query](https://insight.liria.me/getting-started/first-query), or open the
[live demo](https://insight.liria.me/demo).

## Development

The source, tests, architecture records, and docs site live in the
[`liria24/insight-ts`](https://github.com/liria24/insight-ts) workspace.

```sh
bun ci
bun run check
```

## License

[MIT](https://spdx.org/licenses/MIT.html)
