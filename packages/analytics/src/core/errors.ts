export type AnalyticsErrorCode =
    | 'ARCHIVE_CORRUPT'
    | 'CAPABILITY_UNAVAILABLE'
    | 'CONFIGURATION_MISSING'
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

export class AnalyticsProviderError extends Error {
    readonly code: number | string | undefined
    readonly provider: string
    readonly retryable: boolean | undefined
    readonly status: number | undefined

    constructor(
        provider: string,
        message: string,
        options: {
            cause?: unknown
            code?: number | string
            retryable?: boolean
            status?: number
        } = {},
    ) {
        super(message, options.cause === undefined ? undefined : { cause: options.cause })
        this.name = 'AnalyticsProviderError'
        this.provider = provider
        this.code = options.code
        this.retryable = options.retryable
        this.status = options.status
    }
}
