import { inject, provide, type InjectionKey } from 'vue'

import type { BrowserInsight, InsightEventMap } from '../browser/index.ts'

export const browserInsightKey: InjectionKey<unknown> = Symbol('insight-browser')

export const provideBrowserInsight = <Events extends object>(
    insight: BrowserInsight<Events>,
): void => {
    provide(browserInsightKey, insight)
}

export const useBrowserInsight = <
    Events extends object = InsightEventMap,
>(): BrowserInsight<Events> => {
    const insight = inject(browserInsightKey)
    if (!isBrowserInsight(insight)) throw new Error('Browser Insight was not provided')
    return insight
}

const isBrowserInsight = (value: unknown): value is BrowserInsight<object> => {
    return (
        typeof value === 'object' &&
        value !== null &&
        'flush' in value &&
        typeof value.flush === 'function' &&
        'track' in value &&
        typeof value.track === 'function'
    )
}
