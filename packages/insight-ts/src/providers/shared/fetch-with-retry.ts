/* eslint-disable no-await-in-loop -- retries must wait for each response and delay sequentially */

const retryableStatuses = new Set([429, 500, 502, 503, 504])
const maxRetryDelay = 30_000

type Fetch = (input: RequestInfo | URL, init?: RequestInit) => Promise<Response>

interface FetchRetryOptions {
    now?: () => number
    random?: () => number
    retries?: number
    sleep?: (milliseconds: number, signal?: AbortSignal) => Promise<void>
}

export const fetchWithRetry = async (
    fetcher: Fetch,
    input: RequestInfo | URL,
    init?: RequestInit,
    options: FetchRetryOptions = {},
): Promise<Response> => {
    const retries = options.retries ?? 2
    const sleep = options.sleep ?? abortableSleep
    const signal = init?.signal ?? undefined

    for (let attempt = 0; ; attempt += 1) {
        signal?.throwIfAborted()
        let response: Response
        try {
            response = await fetcher(input, init)
        } catch (error) {
            signal?.throwIfAborted()
            // Fetch uses TypeError for network failures. Application exceptions are not transient.
            if (!(error instanceof TypeError) || attempt >= retries) throw error
            const delay = retryDelay(undefined, attempt, options)
            await (signal ? sleep(delay, signal) : sleep(delay))
            continue
        }
        if (!retryableStatuses.has(response.status) || attempt >= retries) return response

        await response.body?.cancel()
        const delay = retryDelay(response, attempt, options)
        await (signal ? sleep(delay, signal) : sleep(delay))
    }
}

const retryDelay = (
    response: Response | undefined,
    attempt: number,
    options: FetchRetryOptions,
): number => {
    const retryAfter = response?.headers.get('retry-after')
    if (retryAfter !== undefined && retryAfter !== null) {
        const seconds = Number(retryAfter)
        if (Number.isFinite(seconds) && seconds >= 0) return boundedDelay(seconds * 1000)

        const timestamp = Date.parse(retryAfter)
        if (Number.isFinite(timestamp))
            return boundedDelay(Math.max(0, timestamp - (options.now?.() ?? Date.now())))
    }
    return boundedDelay(250 * 2 ** attempt * (0.5 + (options.random?.() ?? Math.random())))
}

const boundedDelay = (milliseconds: number): number => Math.min(milliseconds, maxRetryDelay)

const abortableSleep = (milliseconds: number, signal?: AbortSignal): Promise<void> =>
    new Promise((resolve, reject) => {
        signal?.throwIfAborted()
        const done = () => {
            signal?.removeEventListener('abort', aborted)
            resolve()
        }
        const timeout = setTimeout(done, milliseconds)
        const aborted = () => {
            clearTimeout(timeout)
            reject(signal?.reason)
        }
        signal?.addEventListener('abort', aborted, { once: true })
    })
