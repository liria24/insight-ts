import { provideBrowserInsight, useBrowserInsight } from 'insight-ts/vue'

Object.assign(globalThis, { __insightBundleFixture: { provideBrowserInsight, useBrowserInsight } })
