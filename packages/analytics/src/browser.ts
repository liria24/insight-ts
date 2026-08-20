export type AnalyticsEventMap = Record<string, Record<string, unknown>>

export interface BrowserAnalyticsOptions {
    endpoint?: string
    fetch?: typeof globalThis.fetch
    maxBatchSize?: number
}

export interface BrowserAnalytics<Events extends object> {
    flush(): Promise<void>
    track<Name extends Extract<keyof Events, string>>(
        name: Name,
        ...properties: TrackArguments<Events[Name]>
    ): void
}

type TrackArguments<Properties> = keyof Properties extends never
    ? [properties?: Properties]
    : [properties: Properties]

interface QueuedEvent {
    name: string
    properties: unknown
}

const defaultEndpoint = '/api/_analytics/events'
const defaultMaxBatchSize = 20

export function createBrowserAnalytics<Events extends object = AnalyticsEventMap>(
    options: BrowserAnalyticsOptions = {},
): BrowserAnalytics<Events> {
    const endpoint = options.endpoint ?? defaultEndpoint
    const maxBatchSize = options.maxBatchSize ?? defaultMaxBatchSize
    const send = options.fetch ?? globalThis.fetch
    const queue: QueuedEvent[] = []
    let flushing: Promise<void> | undefined
    let scheduled = false

    if (!Number.isSafeInteger(maxBatchSize) || maxBatchSize < 1 || maxBatchSize > 100) {
        throw new RangeError('maxBatchSize must be an integer between 1 and 100')
    }

    const flush = (): Promise<void> => {
        if (flushing) return flushing

        flushing = (async () => {
            while (queue.length > 0) {
                const events = queue.splice(0, maxBatchSize)

                try {
                    // Batches are ordered and a failed batch must stop later sends.
                    // oxlint-disable-next-line no-await-in-loop
                    const response = await send(resolveSameOriginEndpoint(endpoint), {
                        body: JSON.stringify({ events }),
                        credentials: 'same-origin',
                        headers: { 'content-type': 'application/json' },
                        method: 'POST',
                    })

                    if (!response.ok)
                        throw new Error(`Analytics relay responded with ${response.status}`)
                } catch (error) {
                    queue.unshift(...events)
                    throw error
                }
            }
        })().finally(() => {
            flushing = undefined
        })

        return flushing
    }

    const scheduleFlush = (): void => {
        if (scheduled) return
        scheduled = true
        queueMicrotask(() => {
            scheduled = false
            void flush().catch(() => {})
        })
    }

    return {
        flush,
        track(name, ...[properties]) {
            queue.push({ name, properties: properties ?? {} })
            scheduleFlush()
        },
    }
}

function resolveSameOriginEndpoint(endpoint: string): string {
    if (typeof location === 'undefined') return endpoint

    const url = new URL(endpoint, location.origin)
    if (url.origin !== location.origin) throw new TypeError('Analytics relay must be same-origin')
    return url.href
}
