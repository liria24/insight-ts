# @liria24/analytics

Composable analytics queries for Cloudflare and Google Search Console, with optional plain-JSON
archives and Nuxt integration.

> Early development: the `0.0.x` API may change between releases.

## Install

```sh
bun add @liria24/analytics
```

The package exposes focused entry points for the core API, browser client, providers, custom
provider definitions, and Nuxt module. Provider credentials remain in your application;
the SDK does not store OAuth credentials or require a database.

```ts
import { createAnalytics } from '@liria24/analytics'
import { cloudflare } from '@liria24/analytics/cloudflare'

const range = {
    from: '2026-08-01T00:00:00.000Z',
    to: '2026-08-31T00:00:00.000Z',
}

const analytics = createAnalytics({
    name: 'website',
    providers: [
        cloudflare({
            accountId: process.env.CLOUDFLARE_ACCOUNT_ID!,
            apiToken: process.env.CLOUDFLARE_API_TOKEN!,
            webAnalytics: { siteTag: process.env.CLOUDFLARE_SITE_TAG! },
        }),
    ],
})

const report = await analytics.traffic.series({
    grain: 'day',
    metrics: ['pageViews', 'visits'],
    range,
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
bun add vue vue-data-ui
```

```ts
import '@liria24/analytics/vue/style.css'
import { AnalyticsLineChart, AnalyticsStat } from '@liria24/analytics/vue'

// <AnalyticsStat :report="report" metric="pageViews" />
// <AnalyticsLineChart :report="report" :metrics="['pageViews', 'visits']" />
```

The Nuxt module does not register UI components. Import primitives explicitly from the Vue entry.

## License

[MIT](./LICENSE)
