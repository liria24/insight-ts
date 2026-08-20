export type AnalyticsErrorCode =
    | 'ARCHIVE_CORRUPT'
    | 'CAPABILITY_UNAVAILABLE'
    | 'INVALID_QUERY'
    | 'SOURCE_AMBIGUOUS'
    | 'SOURCE_NOT_FOUND'
    | 'UNSUPPORTED_DIMENSION'
    | 'UNSUPPORTED_METRIC'
    | 'UNSAFE_ROLLUP'

export class AnalyticsError extends Error {
    readonly code: AnalyticsErrorCode

    constructor(code: AnalyticsErrorCode, message: string, options?: ErrorOptions) {
        super(message, options)
        this.name = 'AnalyticsError'
        this.code = code
    }
}
