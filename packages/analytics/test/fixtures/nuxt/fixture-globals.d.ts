import type { H3Event, defineEventHandler as defineH3EventHandler } from 'h3'

import type { AnalyticsClient } from '../../../src'

type FixtureAnalyticsConfig = {
    events: {
        pageViewed: { properties: { path: 'string' } }
    }
}

declare global {
    const defineEventHandler: typeof defineH3EventHandler
    const useServerAnalytics: (event?: H3Event) => Promise<AnalyticsClient<FixtureAnalyticsConfig>>
}
