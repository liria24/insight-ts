// @vitest-environment happy-dom

import { afterEach, describe, expect, it, vi } from 'vitest'
import { createSSRApp, h, nextTick } from 'vue'
import { renderToString } from 'vue/server-renderer'

import type { SeriesReport } from '../src/core/index.ts'
import { InsightAreaChart, InsightLineChart } from '../src/integrations/vue/ui/index.ts'

describe('Vue chart hydration', () => {
    afterEach(() => vi.restoreAllMocks())

    it('hydrates server-rendered line and area SVGs without warnings', async () => {
        const report = createReport()
        const Root = () =>
            h('main', [
                h(InsightLineChart, { report, title: 'Line' }),
                h(InsightAreaChart, { report, title: 'Area' }),
            ])
        const html = await renderToString(createSSRApp(Root))
        const container = document.createElement('div')
        container.innerHTML = html
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

function createReport(): SeriesReport {
    return {
        kind: 'series',
        meta: {
            quality: {},
            queriedAt: '2026-08-31T00:00:00.000Z',
            source: 'hydration-test',
            temporal: { bucketTimezone: 'UTC', grain: 'day' },
        },
        points: [
            { time: '2026-08-26T00:00:00.000Z', values: { visits: 10 } },
            { time: '2026-08-31T00:00:00.000Z', values: { visits: 15 } },
        ],
    }
}
