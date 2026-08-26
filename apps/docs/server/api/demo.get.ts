import { createAnalytics } from '@liria24/analytics'
import { cloudflareWebAnalytics } from '@liria24/analytics/cloudflare'

import { createDemoFixture } from '../utils/demo-fixture'

export default defineCachedEventHandler(
    async () => {
        const accountId = process.env.CLOUDFLARE_ACCOUNT_ID
        const apiToken = process.env.CLOUDFLARE_API_TOKEN
        const siteTag = process.env.CLOUDFLARE_SITE_TAG
        if (!accountId && !apiToken && !siteTag) return createDemoFixture()
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
