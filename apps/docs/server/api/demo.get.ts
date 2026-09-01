import { InsightError, ProviderError } from 'insight-ts'
import { cloudflare } from 'insight-ts/cloudflare'

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

        const now = new Date()
        const config = useRuntimeConfig().cloudflare
        if (config.accountId && config.apiToken && config.siteTag) {
            try {
                return await executeDemoQuery(
                    cloudflare({
                        accountId: config.accountId,
                        apiToken: config.apiToken,
                        webAnalytics: { host: config.host, siteTag: config.siteTag },
                    }).adapters.webAnalytics,
                    query,
                    now,
                )
            } catch (error) {
                if (!isUnavailableDemoProvider(error)) throw error
            }
        }
        return createDemoFixture(query, now)
    },
    { maxAge: 4 * 60 * 60 },
)

const isUnavailableDemoProvider = (error: unknown): boolean =>
    error instanceof ProviderError ||
    (error instanceof InsightError &&
        (error.code === 'SOURCE_NOT_FOUND' || error.code === 'CONFIGURATION_MISSING'))
