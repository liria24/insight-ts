export default defineEventHandler(async (event) => {
    const analytics = await useServerAnalytics(event)
    await analytics.track('pageViewed', { path: '/fixture' })
    return { tracked: true }
})
