import type { AnalyticsSeriesReport } from '@liria24/analytics'
import {
    createAnalyticsTimeFormatContext,
    formatAnalyticsTime,
    resolveAnalyticsTimezone,
} from '@liria24/analytics/vue'

export function selectDemoReportRange(
    report: AnalyticsSeriesReport,
    range: readonly [number, number],
): AnalyticsSeriesReport {
    return {
        ...report,
        points: report.points.slice(range[0], range[1] + 1),
    }
}

export function formatDemoReportTime(
    report: AnalyticsSeriesReport,
    index: number,
    locale: string,
    timezone = resolveAnalyticsTimezone(report),
): string {
    const point = report.points[index]
    if (!point) return ''
    return formatAnalyticsTime(
        new Date(point.time),
        createAnalyticsTimeFormatContext(report, index, locale, timezone),
    )
}
