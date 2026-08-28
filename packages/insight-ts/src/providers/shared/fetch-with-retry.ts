/* eslint-disable no-await-in-loop -- retries must wait for each response and delay sequentially */

const retryableStatuses = new Set([429, 500, 502, 503, 504])

type Fetch = (input: RequestInfo | URL, init?: RequestInit) => Promise<Response>

interface FetchRetryOptions {
    now?: () => number
    random?: () => number
    retries?: number
    sleep?: (milliseconds: number) => Promise<void>
}

export const fetchWithRetry = async (
    fetcher: Fetch,
    input: RequestInfo | URL,
    init?: RequestInit,
    options: FetchRetryOptions = {},
): Promise<Response> => {
    const retries = options.retries ?? 2
    const sleep =
        options.sleep ??
        ((milliseconds) => new Promise<void>((resolve) => setTimeout(resolve, milliseconds)))

    for (let attempt = 0; ; attempt += 1) {
        const response = await fetcher(input, init)
        if (!retryableStatuses.has(response.status) || attempt >= retries) return response

        await response.body?.cancel()
        await sleep(retryDelay(response, attempt, options))
    }
}

const retryDelay = (response: Response, attempt: number, options: FetchRetryOptions): number => {
    const retryAfter = response.headers.get('retry-after')
    if (retryAfter !== null) {
        const seconds = Number(retryAfter)
        if (Number.isFinite(seconds) && seconds >= 0) return seconds * 1000

        const timestamp = Date.parse(retryAfter)
        if (Number.isFinite(timestamp))
            return Math.max(0, timestamp - (options.now?.() ?? Date.now()))
    }
    return 250 * 2 ** attempt * (0.5 + (options.random?.() ?? Math.random()))
}
