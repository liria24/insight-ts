import { AnalyticsError } from '@liria24/analytics'

export default defineCachedEventHandler(
    async (event) => {
        try {
            const analytics = await useServerAnalytics(event)
            const now = new Date()
            const report = await analytics.traffic.summary({
                metrics: ['activeUsers'],
                range: {
                    from: new Date(now.valueOf() - 5 * 60 * 1000).toISOString(),
                    to: now.toISOString(),
                },
            })
            return {
                online:
                    typeof report.values.activeUsers === 'number' ? report.values.activeUsers : 0,
            }
        } catch (error) {
            if (
                error instanceof AnalyticsError &&
                (error.code === 'SOURCE_NOT_FOUND' || error.code === 'CONFIGURATION_MISSING')
            ) {
                return { online: 0 }
            }
            throw error
        }
    },
    { maxAge: 60 * 60 },
)
