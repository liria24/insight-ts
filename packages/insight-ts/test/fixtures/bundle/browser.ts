import { createBrowserInsight } from 'insight-ts/browser'

Object.assign(globalThis, {
    __insightBundleFixture: createBrowserInsight({ fetch: globalThis.fetch }),
})
