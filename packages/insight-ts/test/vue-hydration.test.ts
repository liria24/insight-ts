// @vitest-environment happy-dom

import { afterEach, describe, expect, it, vi } from 'vitest'
import { createSSRApp, h, nextTick } from 'vue'
import { renderToString } from 'vue/server-renderer'

import { InsightAreaChart, InsightLineChart } from '../src/integrations/vue/ui/index.ts'
import type { MetricQueryResult } from '../src/ui-core/index.ts'

describe('Vue chart hydration', () => {
    afterEach(() => vi.restoreAllMocks())

    it('hydrates server-rendered line and area SVGs without warnings', async () => {
        const data = createData()
        const Root = () =>
            h('main', [
                h(InsightLineChart, { data, title: 'Line' }),
                h(InsightAreaChart, { data, title: 'Area' }),
            ])
        const container = document.createElement('div')
        container.innerHTML = await renderToString(createSSRApp(Root))
        document.body.append(container)
        const warnings: unknown[][] = []
        vi.spyOn(console, 'warn').mockImplementation((...args) => warnings.push(args))
        vi.spyOn(console, 'error').mockImplementation((...args) => warnings.push(args))

        const app = createSSRApp(Root)
        app.mount(container)
        await nextTick()

        expect(container.querySelectorAll('svg')).toHaveLength(2)
        expect(warnings.filter(([message]) => String(message).includes('Hydration'))).toEqual([])
        app.unmount()
        container.remove()
    })
})

function createData(): MetricQueryResult<'visits'> {
    return {
        data: {
            points: [
                { time: '2026-08-26T00:00:00.000Z', values: { visits: 10 } },
                { time: '2026-08-27T00:00:00.000Z', values: { visits: 15 } },
            ],
            values: { visits: 25 },
        },
        meta: { queriedAt: '2026-08-29T00:00:00.000Z', source: 'test.metrics' },
    }
}
