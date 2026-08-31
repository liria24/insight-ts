<p align="center">
  <img alt="header" src="https://shieldcn.dev/header/dots.svg?title=Insight.ts&amp;subtitle=A+runtime-neutral+TypeScript+SDK+for+analytics%2C+observability%2C+and+application+data.&amp;mode=dark&amp;font=geist" />
</p>

<p align="center">
  <a href="https://www.npmjs.com/package/insight-ts"><img alt="badge" src="https://shieldcn.dev/npm/insight-ts.svg" /></a>
  <a href="https://www.npmjs.com/package/insight-ts"><img alt="license" src="https://shieldcn.dev/npm/license/insight-ts.svg" /></a>
  <a href="https://github.com/liria24/insight-ts/actions"><img alt="CI" src="https://shieldcn.dev/github/liria24/insight-ts/ci.svg" /></a>
</p>

# Insight.ts

Insight.ts is a TypeScript SDK for querying canonical Metrics, Logs, and Traces across services. Configure Providers inside a logical Scope, ask for the data you need, and keep sampling, partiality, and freshness visible without exposing backend topology in query code.

Start with Core and one Provider. Add History, events, Nitro or Nuxt integrations, OpenTelemetry, and Vue UI only when your application needs them.

> **Alpha:** Insight.ts is still under active development. Public APIs may change before the first stable release.

## Install

```sh
npm install insight-ts
```

## Quick start

This example queries page views and visits from Cloudflare Web Analytics.

```ts
import { createInsight } from 'insight-ts'
import { cloudflare } from 'insight-ts/cloudflare'

const insight = createInsight({
    providers: [
        cloudflare({
            accountId,
            apiToken,
            webAnalytics: { siteTag },
        }),
    ],
})

const dashboard = await insight.query((q) => ({
    traffic: q.metrics({
        metrics: ['pageViews', 'visits'],
        time: {
            from: '2026-08-01T00:00:00.000Z',
            to: '2026-08-08T00:00:00.000Z',
            grain: 'day',
        },
        where: {
            country: { in: ['JP', 'US'] },
        },
    }),
}))

console.log(dashboard.traffic.data.values.pageViews)
```

Configured canonical Metrics and dimensions are inferred across Provider adapters without `as const` or explicit generics.

## Why Insight.ts?

### Typed end to end

A Scope's adapters define the canonical fields they can execute. TypeScript carries that information through `insight.query()`, while runtime capability intersections reject incompatible cross-adapter dimensions and filters before I/O.

### Provider details stay visible

Cloudflare, Search Console, application databases, observability systems, and other services do not expose identical capabilities.

Insight.ts gives them canonical query contracts without hiding differences such as sampling, approximation, partial results, pagination, or freshness.

### Add only what you need

Core does not require a framework, History engine, UI renderer, or OpenTelemetry runtime. Features are exposed through focused entrypoints so applications can opt into them independently.

## Providers

Built-in support currently includes:

- **Cloudflare Web Analytics** — page views, visits, dimensions, filters, and quality metadata
- **Cloudflare Analytics Engine** — Metric queries, event delivery, or both
- **Google Search Console** — Search Analytics metrics with bounded native pagination and data-state metadata
- **Application-defined adapters** — canonical Metric and Log adapters through focused entrypoints and custom Providers through `defineProvider()`

Custom adapters use the same scope-aware planning and result merging as built-in Providers.

## UI

Insight.ts includes optional Vue components for Metric results.

```vue
<script setup lang="ts">
import { InsightAreaChart, InsightStat } from 'insight-ts/vue/ui'
</script>

<template>
    <InsightStat :data="dashboard.summary" />

    <InsightAreaChart :data="dashboard.traffic" title="Traffic" :ui="{ title: 'font-semibold' }" />
</template>
```

UI components render existing query results. They do not fetch Providers, handle credentials, or run History work.

All components support root `class` customization and semantic `ui` slots for their internal elements.

## Documentation

The complete documentation is available at [insight.liria.me](https://insight.liria.me).

- [Introduction](https://insight.liria.me/getting-started/introduction)
- [Installation](https://insight.liria.me/getting-started/installation)
- [First query](https://insight.liria.me/getting-started/first-query)
- [Providers](https://insight.liria.me/providers/cloudflare)
- [UI](https://insight.liria.me/ui/stat)
- [Guides](https://insight.liria.me/guides/data-model)
- [API reference](https://insight.liria.me/reference/api)
- [Live demo](https://insight.liria.me/demo)

## Development

This repository is a Bun workspace containing the SDK, documentation site, tests, and architecture records.

```sh
bun ci
bun run check
bun run bundle:size
bun run bench
bun run docs:dev
```

`bun run check` runs Oxfmt, Oxlint, Sherif, Knip (full and production modes),
typechecking, Vitest, the package build with publint/ATTW, and packed consumer contracts. Consumer
bundle sizes and Bencher benchmarks run in separate informational workflows so size or performance
changes do not duplicate correctness gates or fail CI by themselves. `taze` remains available through
`bun run deps:update` for manual dependency updates; Renovate handles scheduled updates.

Bencher reads Vitest's JSON benchmark output directly. To enable its GitHub reports, set the
`BENCHER_PROJECT` repository variable and the `BENCHER_API_KEY` repository secret.

`main` is the only development trunk. Normal changes use a short-lived branch, pull request, and
squash merge. Uppt alone owns temporary `release/v*` branches and the existing release PR, tag,
GitHub Release, and npm OIDC staged-publishing flow.

Repository structure:

- `packages/insight-ts` — published SDK and tests
- `apps/docs` — Docus documentation and product site
- `docs/architecture` — architecture invariants and accepted decisions
- `.agents/skills` — repository-specific development guidance

Add dependencies from the workspace that owns them.

## License

[MIT](./LICENSE)
