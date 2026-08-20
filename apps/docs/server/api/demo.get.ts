import { createAnalytics, type AnalyticsSeriesReport } from '@liria24/analytics'
import { cloudflareWebAnalytics } from '@liria24/analytics/cloudflare'

const fixture: AnalyticsSeriesReport = {
    kind: 'series',
    meta: {
        quality: {},
        queriedAt: '2026-08-20T00:00:00.000Z',
        source: 'demo-fixture',
        temporal: { bucketTimezone: 'UTC', grain: 'day' },
    },
    points: [
        { time: '2026-08-18T00:00:00.000Z', values: { pageViews: 1240, visits: 812 } },
        { time: '2026-08-19T00:00:00.000Z', values: { pageViews: 1386, visits: 901 } },
        { time: '2026-08-20T00:00:00.000Z', values: { pageViews: 1421, visits: 936 } },
    ],
}

export default defineCachedEventHandler(
    async () => {
        const accountId = process.env.CLOUDFLARE_ACCOUNT_ID
        const apiToken = process.env.CLOUDFLARE_API_TOKEN
        const siteTag = process.env.CLOUDFLARE_SITE_TAG
        if (!accountId && !apiToken && !siteTag) return fixture
        if (!accountId || !apiToken || !siteTag) {
            throw new Error('Cloudflare demo credentials are incomplete')
        }

        const analytics = createAnalytics({
            adapters: [cloudflareWebAnalytics({ accountId, apiToken, siteTag })],
            name: 'docs-demo',
        })
        return analytics.query({
            dimensions: ['time'],
            grain: 'day',
            metrics: ['pageViews', 'visits'],
            range: '7d',
        })
    },
    { maxAge: 12 * 60 * 60 },
)
