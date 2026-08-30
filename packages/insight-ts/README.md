<p align="center">
  <img alt="header" src="https://shieldcn.dev/header/dots.svg?title=Insight.ts&amp;subtitle=A+runtime-neutral+TypeScript+SDK+for+analytics%2C+observability%2C+and+application+data.&amp;mode=dark&amp;font=geist" />
</p>

<p align="center">
  <a href="https://www.npmjs.com/package/insight-ts"><img alt="badge" src="https://shieldcn.dev/npm/insight-ts.svg" /></a>
  <a href="https://www.npmjs.com/package/insight-ts"><img alt="license" src="https://shieldcn.dev/npm/license/insight-ts.svg" /></a>
  <a href="https://github.com/liria24/insight-ts/actions"><img alt="CI" src="https://shieldcn.dev/github/liria24/insight-ts/ci.svg" /></a>
</p>

# Insight.ts

Insight.ts is a TypeScript SDK for querying data from different services without forcing them into one shared schema. Configure explicit Sources, query them through one API, and keep each Provider's metrics, limits, sampling, and metadata visible.

Start with Core and one Source. Add Providers, History, events, framework integrations, OpenTelemetry, or Vue UI only when you need them.

> **Alpha:** Insight.ts is still under active development. Public APIs may change before the first stable release.

## Install

```sh
npm install insight-ts
```

## Quick start

```ts
import { createInsight } from 'insight-ts'
import { cloudflareWebAnalytics } from 'insight-ts/cloudflare'
import { defineProvider } from 'insight-ts/provider'

const cloudflare = defineProvider({
    id: 'cloudflare',
    sources: {
        webAnalytics: cloudflareWebAnalytics({
            accountId,
            apiToken,
            siteTag,
        }),
    },
})

const insight = createInsight({
    providers: [cloudflare] as const,
})

const dashboard = await insight.query((q) => ({
    traffic: q.source('cloudflare.webAnalytics', {
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

console.log(dashboard.traffic.data.pageViews.value)
```

The Source ID, query fields, selected metrics and dimensions, result data, and metadata stay typed throughout the query.

## What you get

- **Typed queries and results** — Sources define exactly what they accept and return.
- **Provider details stay visible** — sampling, approximation, partial results, pagination, freshness, and native metadata are not hidden behind artificial parity.
- **Composable features** — use Core alone or add Providers, History, browser events, Nitro, Nuxt, Vue UI, and OpenTelemetry independently.
- **Custom Sources** — application and service-specific data can use the same execution API without changing Core.

## Built-in Providers

Insight.ts currently includes support for:

- Cloudflare Web Analytics
- Cloudflare Analytics Engine
- Google Search Console

Use `defineSource()` and `defineProvider()` for application-specific or third-party data.

## Vue UI

Optional Metric components render data you have already queried.

```vue
<script setup lang="ts">
import { InsightAreaChart, InsightStat } from 'insight-ts/vue/ui'
</script>

<template>
    <InsightStat :data="dashboard.summary" />

    <InsightAreaChart :data="dashboard.traffic" title="Traffic" :ui="{ title: 'font-semibold' }" />
</template>
```

Components support root `class` customization and semantic `ui` slots. They do not query Providers or manage credentials themselves.

## Documentation

Read the complete documentation at [insight.liria.me](https://insight.liria.me).

- [Get started](https://insight.liria.me/getting-started/introduction)
- [First query](https://insight.liria.me/getting-started/first-query)
- [Providers](https://insight.liria.me/providers/cloudflare)
- [UI](https://insight.liria.me/ui/stat)
- [Guides](https://insight.liria.me/guides/data-model)
- [API reference](https://insight.liria.me/reference/api)
- [Live demo](https://insight.liria.me/demo)

## License

[MIT](https://spdx.org/licenses/MIT.html)
