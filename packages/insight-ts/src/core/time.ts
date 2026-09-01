import { InsightError } from './errors.ts'

export interface TimeRange {
    from: string
    to: string
}

export const normalizeTimeRange = (range: TimeRange): TimeRange => {
    const from = new Date(range.from)
    const to = new Date(range.to)
    if (!Number.isFinite(from.valueOf()) || !Number.isFinite(to.valueOf()) || from >= to) {
        throw new InsightError(
            'INVALID_QUERY',
            'Time must contain valid absolute from and to timestamps with from before to',
        )
    }
    return { from: from.toISOString(), to: to.toISOString() }
}

export const normalizeTimestamp = (value: string, name: string): string => {
    const date = new Date(value)
    if (!Number.isFinite(date.valueOf())) {
        throw new InsightError('INVALID_QUERY', `${name} must be an ISO timestamp`)
    }
    return date.toISOString()
}
