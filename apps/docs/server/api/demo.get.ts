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
            const [summary, series] = await Promise.all([
                analytics.traffic.summary({ metrics: ['pageViews', 'visits'], range: query.range }),
                analytics.traffic.series({
                    grain: query.grain,
                    metrics: ['pageViews', 'visits'],
                    range: query.range,
                }),
            ])
            return { series, summary }
        } catch (error) {
            if (isUnavailableDemoProvider(error)) return createDemoFixture(query)
            throw error
        }
    },
    { maxAge: 60 * 60 },
)

function isUnavailableDemoProvider(error: unknown): boolean {
    return (
        error instanceof AnalyticsError &&
        (error.code === 'SOURCE_NOT_FOUND' || error.code === 'CONFIGURATION_MISSING')
    )
}
