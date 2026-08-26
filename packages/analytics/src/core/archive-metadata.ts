import type { AnalyticsAdapter } from './types'

const recommendedArchiveStarts = new WeakMap<AnalyticsAdapter, (now: Date) => Date>()

export function recommendArchiveMonths(
    adapter: AnalyticsAdapter,
    months: number,
): AnalyticsAdapter {
    recommendedArchiveStarts.set(adapter, (now) => {
        const start = new Date(now)
        start.setUTCMonth(start.getUTCMonth() - months)
        return start
    })
    return adapter
}

export function recommendedArchiveStart(adapter: AnalyticsAdapter, now: Date): Date | undefined {
    return recommendedArchiveStarts.get(adapter)?.(now)
}
