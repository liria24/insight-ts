import type { AnalyticsAdapter, AnalyticsDuration } from './types'

interface ArchiveProviderMetadata {
    finalizationDelay: AnalyticsDuration
    initialLookbackMonths: number
}

const providerMetadata = new WeakMap<AnalyticsAdapter, ArchiveProviderMetadata>()

export function withArchiveProviderMetadata(
    adapter: AnalyticsAdapter,
    metadata: ArchiveProviderMetadata,
): AnalyticsAdapter {
    providerMetadata.set(adapter, metadata)
    return adapter
}

export function archiveProviderMetadata(
    adapter: AnalyticsAdapter,
): ArchiveProviderMetadata | undefined {
    return providerMetadata.get(adapter)
}

export function recommendedArchiveStart(adapter: AnalyticsAdapter, now: Date): Date | undefined {
    const metadata = providerMetadata.get(adapter)
    if (!metadata) return undefined
    const start = new Date(now)
    start.setUTCMonth(start.getUTCMonth() - metadata.initialLookbackMonths)
    return start
}
