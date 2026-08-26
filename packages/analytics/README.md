# @liria24/analytics

Composable analytics queries for Cloudflare and Google Search Console, with optional plain-JSON
archives and Nuxt integration.

> Early development: the `0.0.x` API may change between releases.

## Install

```sh
bun add @liria24/analytics
```

The package exposes focused entry points for the core API, browser client, Cloudflare adapters,
Google Search Console adapter, and Nuxt module. Provider credentials remain in your application;
the SDK does not store OAuth credentials or require a database.

```ts
import { createAnalytics } from '@liria24/analytics'
import { cloudflareWebAnalytics } from '@liria24/analytics/cloudflare'

const analytics = createAnalytics({
    name: 'website',
    adapters: [
        cloudflareWebAnalytics({
            accountId: process.env.CLOUDFLARE_ACCOUNT_ID!,
            apiToken: process.env.CLOUDFLARE_API_TOKEN!,
            siteTag: process.env.CLOUDFLARE_SITE_TAG!,
        }),
    ],
})

const report = await analytics.traffic.series({
    grain: 'day',
    metrics: ['pageViews', 'visits'],
    range: '30d',
})
```

Google Search Console accepts a host-owned access-token callback:

```ts
import { googleSearchConsole } from '@liria24/analytics/google-search-console'

const search = googleSearchConsole({
    property: 'sc-domain:example.com',
    auth: { getAccessToken: () => getAccessTokenFromServerSecrets() },
})
```

See [analytics.liria.me](https://analytics.liria.me) for Nuxt, provider, archive, and event setup.

## Vue UI

The optional `@liria24/analytics/vue` entry provides small report-only primitives. It never
queries providers, caches results, or chooses a dashboard layout:

```sh
bun add vue-data-ui jspdf
```

```ts
import 'vue-data-ui/style.css'
import { AnalyticsLineChart, AnalyticsStat } from '@liria24/analytics/vue'

// <AnalyticsStat :report="report" metric="pageViews" />
// <AnalyticsLineChart :report="report" :metrics="['pageViews', 'visits']" />
```

The Nuxt module does not register UI components. Import primitives explicitly from the Vue entry.

## License

[MIT](./LICENSE)
