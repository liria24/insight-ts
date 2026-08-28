# Insight.ts

Typed Provider capabilities, History, and optional runtime/UI integrations for TypeScript.

```sh
bun add insight-ts
```

```ts
import { createInsight } from 'insight-ts'
import { cloudflareWebAnalytics } from 'insight-ts/cloudflare'
import { defineProvider } from 'insight-ts/provider'

const cloudflare = defineProvider({
    id: 'cloudflare',
    reports: {
        webAnalytics: cloudflareWebAnalytics({ accountId, apiToken, siteTag }),
    },
})
const insight = createInsight({ providers: [cloudflare] })

const report = await insight.reports('cloudflare.webAnalytics').series({
    metrics: ['pageViews', 'visits'],
    grain: 'day',
    range: { from: '2026-08-01T00:00:00.000Z', to: '2026-09-01T00:00:00.000Z' },
})
```

Focused entrypoints include `provider`, `history`, `ui-core`, `nitro`, `nuxt`, `browser`, `vue`,
and optional `vue/ui`. Importing Vue UI automatically loads its base CSS and private TanStack
Charts renderer; no other entrypoint reaches renderer code.

```ts
import { InsightAreaChart, InsightLineChart, InsightStat } from 'insight-ts/vue/ui'
```

See [insight.liria.me](https://insight.liria.me).

## License

[MIT](./LICENSE)
