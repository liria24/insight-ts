// @vitest-environment happy-dom

import { afterEach, describe, expect, it, vi } from 'vitest'
import { createSSRApp, h, nextTick } from 'vue'
import { renderToString } from 'vue/server-renderer'

import { InsightChart } from '../src/integrations/vue/ui/index.ts'
import type { MetricQueryResult } from '../src/ui-core/index.ts'

describe('Vue chart hydration', () => {
    afterEach(() => vi.restoreAllMocks())

    it('hydrates server-rendered line, area, and bar SVGs without warnings', async () => {
        const data = createData()
        const Root = () =>
            h('main', [
                h(InsightChart, { data, title: 'Line' }),
                h(InsightChart, { data, title: 'Area', type: 'area' }),
                h(InsightChart, { data, title: 'Bar', type: 'bar' }),
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

        expect(container.querySelectorAll('svg')).toHaveLength(3)
        expect(warnings.filter(([message]) => String(message).includes('Hydration'))).toEqual([])
        app.unmount()
        container.remove()
    })

    it('mounts a large exact-value table only when requested', async () => {
        const data: MetricQueryResult<'errors' | 'requests'> = {
            aggregate: { errors: 125_250, requests: 250_500 },
            meta: { queriedAt: '2026-08-29T00:00:00.000Z' },
            rows: Array.from({ length: 501 }, (_, index) => ({
                time: new Date(Date.UTC(2026, 0, 1) + index * 60_000).toISOString(),
                values: { errors: index, requests: index * 2 },
            })),
        }
        const Root = () => h(InsightChart, { data })
        const container = document.createElement('div')
        container.innerHTML = await renderToString(createSSRApp(Root))
        document.body.append(container)
        const app = createSSRApp(Root)
        app.mount(container)

        expect(container.querySelector('table')).toBeNull()
        const button = container.querySelector<HTMLButtonElement>('[data-slot="data-toggle"]')
        button?.click()
        await nextTick()

        expect(button?.getAttribute('aria-expanded')).toBe('true')
        expect(container.querySelectorAll('tbody tr')).toHaveLength(501)
        app.unmount()
        container.remove()
    })
})

function createData(): MetricQueryResult<'visits'> {
    return {
        aggregate: { visits: 25 },
        meta: { queriedAt: '2026-08-29T00:00:00.000Z' },
        rows: [
            { time: '2026-08-26T00:00:00.000Z', values: { visits: 10 } },
            { time: '2026-08-27T00:00:00.000Z', values: { visits: 15 } },
        ],
    }
}
