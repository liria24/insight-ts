import { AnalyticsError } from '@liria24/analytics'

import { resolveDemoReportQuery } from '../../shared/demo-range'

export default defineCachedEventHandler(
    async (event) => {
        let query
        try {
            query = resolveDemoReportQuery(getQuery(event))
        } catch (error) {
            throw createError({
                statusCode: 400,
                statusMessage: error instanceof Error ? error.message : 'Invalid demo range',
            })
        }
        try {
            const analytics = await useServerAnalytics(event)
            const now = new Date()
            const [summary, series, online] = await Promise.all([
                analytics.traffic.summary({ metrics: ['pageViews', 'visits'], range: query.range }),
                analytics.traffic.series({
                    grain: query.grain,
                    metrics: ['pageViews', 'visits'],
                    range: query.range,
                }),
                analytics.traffic
                    .summary({
                        metrics: ['activeUsers'],
                        range: {
                            from: new Date(now.valueOf() - 5 * 60 * 1000).toISOString(),
                            to: now.toISOString(),
                        },
                    })
                    .then(({ values }) =>
                        typeof values.activeUsers === 'number' ? values.activeUsers : 0,
                    )
                    .catch((error) => {
                        if (isUnavailableDemoProvider(error)) return 0
                        throw error
                    }),
            ])
            return { online, series, summary }
        } catch (error) {
            if (isUnavailableDemoProvider(error)) return createDemoFixture(query)
            throw error
        }
    },
    { maxAge: 4 * 60 * 60 },
)

function isUnavailableDemoProvider(error: unknown): boolean {
    return (
        error instanceof AnalyticsError &&
        (error.code === 'SOURCE_NOT_FOUND' || error.code === 'CONFIGURATION_MISSING')
    )
}
