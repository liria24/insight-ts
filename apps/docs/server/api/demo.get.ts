import { AnalyticsError } from '@liria24/analytics'

import { createDemoFixture } from '../utils/demo-fixture'

export default defineCachedEventHandler(
    async (event) => {
        try {
            const analytics = await useServerAnalytics(event)
            return await analytics.query({
                dimensions: ['time'],
                grain: 'day',
                metrics: ['pageViews', 'visits'],
                range: '7d',
            })
        } catch (error) {
            if (isUnavailableDemoProvider(error)) return createDemoFixture()
            throw error
        }
    },
    { maxAge: 12 * 60 * 60 },
)

function isUnavailableDemoProvider(error: unknown): boolean {
    return (
        (error instanceof AnalyticsError && error.code === 'SOURCE_NOT_FOUND') ||
        (error instanceof Error &&
            error.message === 'Cloudflare Web Analytics credentials are missing')
    )
}
