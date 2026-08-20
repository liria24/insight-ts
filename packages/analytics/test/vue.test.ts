import { describe, expect, it, vi } from 'vitest'
import { createSSRApp, defineComponent, h } from 'vue'
import { renderToString } from 'vue/server-renderer'

import { createBrowserAnalytics, type BrowserAnalytics } from '../src/browser'
import { provideAnalytics, useAnalytics } from '../src/vue'

interface Events {
    signup: { plan: string }
}

describe('Vue integration', () => {
    it('provides the browser client to descendants', async () => {
        const analytics = createBrowserAnalytics<Events>({ fetch: vi.fn<typeof fetch>() })
        let injected: BrowserAnalytics<Events> | undefined
        const Child = defineComponent(() => {
            injected = useAnalytics<Events>()
            return () => h('span')
        })
        const app = createSSRApp(
            defineComponent(() => {
                provideAnalytics(analytics)
                return () => h(Child)
            }),
        )

        await renderToString(app)

        expect(injected).toBe(analytics)
    })
})
