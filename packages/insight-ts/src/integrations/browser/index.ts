export type InsightEventMap = Record<string, Record<string, unknown>>

export interface BrowserInsightErrorContext {
    dropped: number
    reason: 'event-too-large' | 'queue-overflow' | 'send'
    retries: number
}

export interface BrowserInsightOptions {
    endpoint?: string
    fetch?: typeof globalThis.fetch
    flushIntervalMs?: number
    maxBatchBytes?: number
    maxBatchSize?: number
    maxQueueSize?: number
    maxRetries?: number
    onError?(error: unknown, context: BrowserInsightErrorContext): void
    retryDelayMs?: number
}

export interface BrowserInsight<Events extends object> {
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
    bytes: number
    json: string
}

const defaultEndpoint = '/api/_insight/events'
const defaultFlushIntervalMs = 50
const defaultMaxBatchBytes = 64 * 1024
const defaultMaxBatchSize = 20
const defaultMaxQueueSize = 1000
const defaultMaxRetries = 2
const defaultRetryDelayMs = 100
const envelopeBytes = new TextEncoder().encode('{"events":[]}').byteLength

export const createBrowserInsight = <Events extends object = InsightEventMap>(
    options: BrowserInsightOptions = {},
): BrowserInsight<Events> => {
    const endpoint = resolveSameOriginEndpoint(options.endpoint ?? defaultEndpoint)
    const flushIntervalMs = integer(
        options.flushIntervalMs ?? defaultFlushIntervalMs,
        'flushIntervalMs',
        1,
    )
    const maxBatchBytes = integer(
        options.maxBatchBytes ?? defaultMaxBatchBytes,
        'maxBatchBytes',
        envelopeBytes + 2,
    )
    const maxBatchSize = integer(
        options.maxBatchSize ?? defaultMaxBatchSize,
        'maxBatchSize',
        1,
        100,
    )
    const maxQueueSize = integer(options.maxQueueSize ?? defaultMaxQueueSize, 'maxQueueSize', 1)
    const maxRetries = integer(options.maxRetries ?? defaultMaxRetries, 'maxRetries', 0, 5)
    const retryDelayMs = integer(options.retryDelayMs ?? defaultRetryDelayMs, 'retryDelayMs', 0)
    const send = options.fetch ?? globalThis.fetch
    const encoder = new TextEncoder()
    const queue: QueuedEvent[] = []
    let flushing: Promise<void> | undefined
    let head = 0
    let queuedBytes = 0
    let timer: ReturnType<typeof setTimeout> | undefined

    const activeCount = () => queue.length - head

    const report = (error: unknown, context: BrowserInsightErrorContext): void => {
        try {
            options.onError?.(error, context)
        } catch {}
    }

    const advance = (count: number): void => {
        for (let index = head; index < head + count; index += 1) queuedBytes -= queue[index]!.bytes
        head += count
        if (head === queue.length) {
            queue.length = 0
            head = 0
            queuedBytes = 0
        }
    }

    const nextBatch = (): { body: string; count: number } => {
        const events: string[] = []
        let bytes = envelopeBytes
        for (let index = head; index < queue.length && events.length < maxBatchSize; index += 1) {
            const event = queue[index]!
            const nextBytes = bytes + event.bytes + (events.length > 0 ? 1 : 0)
            if (events.length > 0 && nextBytes > maxBatchBytes) break
            events.push(event.json)
            bytes = nextBytes
        }
        return { body: `{"events":[${events.join(',')}]}`, count: events.length }
    }

    const deliver = async (body: string): Promise<{ error?: unknown; retries: number }> => {
        for (let retries = 0; retries <= maxRetries; retries += 1) {
            let error: unknown
            let retryable = true
            try {
                // Delivery retries are intentionally serialized.
                // oxlint-disable-next-line no-await-in-loop
                const response = await send(endpoint, {
                    body,
                    credentials: 'same-origin',
                    headers: { 'content-type': 'application/json' },
                    keepalive: true,
                    method: 'POST',
                })
                if (response.ok) return { retries }
                error = new Error(`Insight relay responded with ${response.status}`)
                retryable =
                    response.status === 408 || response.status === 429 || response.status >= 500
            } catch (caught) {
                error = caught ?? new Error('Insight relay delivery failed')
            }
            if (!retryable || retries === maxRetries) return { error, retries }
            // oxlint-disable-next-line no-await-in-loop
            await delay(Math.min(retryDelayMs * 2 ** retries, 30_000))
        }
        return { error: new Error('Insight relay delivery failed'), retries: maxRetries }
    }

    const flush = (): Promise<void> => {
        if (timer) {
            clearTimeout(timer)
            timer = undefined
        }
        if (flushing) return flushing

        flushing = (async () => {
            let firstError: unknown
            while (activeCount() > 0) {
                const batch = nextBatch()
                // Batches and retries are serialized to preserve enqueue order.
                // oxlint-disable-next-line no-await-in-loop
                const result = await deliver(batch.body)
                advance(batch.count)
                if (result.error !== undefined) {
                    firstError ??= result.error
                    report(result.error, {
                        dropped: batch.count,
                        reason: 'send',
                        retries: result.retries,
                    })
                }
            }
            if (firstError !== undefined) throw firstError
        })().finally(() => {
            flushing = undefined
        })

        return flushing
    }

    const scheduleFlush = (): void => {
        if (timer || flushing) return
        timer = setTimeout(() => {
            timer = undefined
            void flush().catch(() => {})
        }, flushIntervalMs)
    }

    const flushNow = (): void => {
        if (timer) {
            clearTimeout(timer)
            timer = undefined
        }
        void flush().catch(() => {})
    }

    if (typeof globalThis.addEventListener === 'function') {
        globalThis.addEventListener('pagehide', flushNow)
    }

    return {
        flush,
        track(name, ...[properties]) {
            const json = JSON.stringify({ name, properties: properties ?? {} })
            const bytes = encoder.encode(json).byteLength
            if (bytes + envelopeBytes > maxBatchBytes) {
                report(new RangeError('Insight event exceeds maxBatchBytes'), {
                    dropped: 1,
                    reason: 'event-too-large',
                    retries: 0,
                })
                return
            }
            if (activeCount() >= maxQueueSize) {
                report(new RangeError('Insight event queue is full'), {
                    dropped: 1,
                    reason: 'queue-overflow',
                    retries: 0,
                })
                return
            }
            queue.push({ bytes, json })
            queuedBytes += bytes
            if (
                activeCount() >= maxBatchSize ||
                queuedBytes + envelopeBytes + activeCount() - 1 >= maxBatchBytes
            ) {
                flushNow()
            } else scheduleFlush()
        },
    }
}

const delay = (milliseconds: number): Promise<void> =>
    new Promise((resolve) => setTimeout(resolve, milliseconds))

const integer = (
    value: number,
    name: string,
    minimum: number,
    maximum = Number.MAX_SAFE_INTEGER,
) => {
    if (!Number.isSafeInteger(value) || value < minimum || value > maximum) {
        throw new RangeError(`${name} must be an integer between ${minimum} and ${maximum}`)
    }
    return value
}

const resolveSameOriginEndpoint = (endpoint: string): string => {
    if (typeof location === 'undefined') return endpoint

    const url = new URL(endpoint, location.origin)
    if (url.origin !== location.origin) throw new TypeError('Insight relay must be same-origin')
    return url.href
}
