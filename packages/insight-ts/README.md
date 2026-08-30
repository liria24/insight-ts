# Insight.ts

> A runtime-neutral TypeScript SDK for typed, provider-aware data queries.

[![Runtime neutral](https://shieldcn.dev/badge/runtime-neutral-TypeScript-18181b.svg?variant=outline)](https://insight.liria.me/getting-started/introduction)
[![Provider aware](https://shieldcn.dev/badge/provider-aware-18181b.svg?variant=outline)](https://insight.liria.me/concepts/overview)
[![License](https://shieldcn.dev/badge/license-MIT-18181b.svg?variant=outline)](https://spdx.org/licenses/MIT.html)

Insight.ts queries analytics, observability, and application data without forcing unrelated services
into one report model. Sources keep their own query shape, metrics, limits, quality, and metadata;
Core gives you one typed execution API.

## Install

```sh
bun add insight-ts
# pnpm add insight-ts
# npm install insight-ts
# yarn add insight-ts
# vlt add insight-ts
```

## Quick start

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

## What it provides

- **Typed Sources:** Query and result types stay literal from Provider setup through `insight.query()`.
- **Provider-aware results:** Native capability, sampling, approximation, freshness, and partial
  results remain visible instead of being silently normalized away.
- **Small optional imports:** Add only the Provider, History, host integration, browser client, or UI
  entrypoint your application uses.

## Public entrypoints

| Entrypoint                         | Purpose                                                                         |
| ---------------------------------- | ------------------------------------------------------------------------------- |
| `insight-ts`                       | Core `createInsight`, generic Source execution, events, and shared errors/types |
| `insight-ts/provider`              | `defineSource()` and `defineProvider()`                                         |
| `insight-ts/metrics`               | Metric definitions, structured aggregation, and typed object filters            |
| `insight-ts/cloudflare`            | Cloudflare Web Analytics and Analytics Engine                                   |
| `insight-ts/google-search-console` | Google Search Console Search Analytics                                          |
| `insight-ts/history`               | Metric History Engine and repository contract                                   |
| `insight-ts/nitro`                 | Nitro Storage repository and optional History task wiring                       |
| `insight-ts/nuxt`                  | Nuxt module, built-in Provider config, and server `useInsight()`                |
| `insight-ts/browser`               | Bounded same-origin browser event client                                        |
| `insight-ts/vue`                   | Vue provide/inject for a Browser Insight client                                 |
| `insight-ts/ui-core`               | Framework- and renderer-independent Metric models                               |
| `insight-ts/vue/ui`                | Optional Vue Metric components, base CSS, and private chart renderer            |
| `insight-ts/opentelemetry`         | Optional adapter for host-owned OpenTelemetry APIs                              |

## Providers

Built-in Providers currently cover Cloudflare Web Analytics, Cloudflare Analytics Engine, and Google
Search Console. Use `defineProvider()` for application or service-specific Sources; the same source
inference, validation, metadata, and History contracts apply.

## History, events, and UI

```ts
import { createHistory } from 'insight-ts/history'

const insight = createInsight({
    providers,
    history: createHistory({ repository, sources: ['cloudflare.webAnalytics'] }),
})

await insight.history.sync({ range })
```

History materializes Source-declared Metric ranges through normal query execution. It fetches gaps,
recomputes derived ratios, rejects unsafe rollups, and keeps reduction visible as Fidelity metadata.
It is not a persistent query-result cache.

Browser events are same-origin and best effort; the receiving host validates the schema and creates
authoritative IDs, timestamps, and origin. `insight-ts/vue` only injects that browser client into a
Vue tree.

```ts
import { InsightAreaChart, InsightStat } from 'insight-ts/vue/ui'
```

Vue UI components render existing Metric `QueryResult` values through `data`; they do not fetch
Providers, handle auth, cache, or run History. All components accept a root `class` and semantic
`ui` class slots. Line and area charts render every selected Metric in Source order, while Stat,
Sparkline, and BarChart select only the presentation data they need.

## Documentation

Read the [documentation](https://insight.liria.me), follow the
[first query](https://insight.liria.me/getting-started/first-query), or open the
[live demo](https://insight.liria.me/demo).

## Development

```sh
bun ci
bun run check
```

The source, tests, architecture records, and docs site live in the
[`liria24/insight-ts`](https://github.com/liria24/insight-ts) workspace.

## License

[MIT](https://spdx.org/licenses/MIT.html)
