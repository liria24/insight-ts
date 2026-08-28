export type InsightErrorCode =
    | 'CAPABILITY_UNAVAILABLE'
    | 'CONFIGURATION_MISSING'
    | 'HISTORY_CORRUPT'
    | 'HISTORY_STORAGE_MISSING'
    | 'INVALID_QUERY'
    | 'SOURCE_NOT_FOUND'
    | 'UNSAFE_ROLLUP'
    | 'UNSUPPORTED_DIMENSION'
    | 'UNSUPPORTED_METRIC'
    | 'UNSUPPORTED_OPERATION'

export class InsightError extends Error {
    readonly code: InsightErrorCode

    constructor(code: InsightErrorCode, message: string, options?: ErrorOptions) {
        super(message, options)
        this.name = 'InsightError'
        this.code = code
    }
}

export class ProviderError extends Error {
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
        this.name = 'ProviderError'
        this.provider = provider
        this.code = options.code
        this.retryable = options.retryable
        this.status = options.status
    }
}
