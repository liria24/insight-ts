/* eslint-disable no-await-in-loop -- packed consumers intentionally run in isolated directories */

import { access, mkdir, mkdtemp, rm } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { basename, join } from 'node:path'

interface Consumer {
    dependencies?: readonly string[]
    name: string
    nuxt?: boolean
    source: string
}

const packageRoot = join(import.meta.dir, '..')
const cache = new TextDecoder()
    .decode(Bun.spawnSync([process.execPath, 'pm', 'cache']).stdout)
    .trim()
const root = await mkdtemp(join(tmpdir(), 'insight-ts-consumers-'))

const consumers: readonly Consumer[] = [
    {
        name: 'core',
        source: `import { createInsight, defineProvider } from 'insight-ts'
import { cloudflare } from 'insight-ts/cloudflare'
import { googleSearchConsole } from 'insight-ts/google-search-console'
import { defineLogAdapter } from 'insight-ts/logs'
import { defineMetricAdapter } from 'insight-ts/metrics'
import { defineTraceAdapter } from 'insight-ts/traces'

const value = defineMetricAdapter({
  execute: () => ({ values: { value: 42 } }),
  metrics: { value: {} },
})
const logs = defineLogAdapter({ execute: () => ({ logs: [{ id: 'log-1', timestamp: '2026-08-01' }] }) })
const traces = defineTraceAdapter({ execute: () => ({ traces: [{ startTime: '2026-08-01', traceId: 'trace-1' }] }) })
const insight = createInsight({ providers: [defineProvider({ adapters: { logs, traces, value }, id: 'app' })] })
const result = await insight.query((q) => ({
  logs: q.logs({ time: { from: '2026-08-01', to: '2026-08-02' } }),
  traces: q.traces({ time: { from: '2026-08-01', to: '2026-08-02' } }),
  value: q.metrics({ metrics: ['value'], time: { from: '2026-08-01', to: '2026-08-02' } }),
}))
if (result.value.data.values.value !== 42 || result.logs.data.logs[0]?.id !== 'log-1' || result.traces.data.traces[0]?.traceId !== 'trace-1') throw new Error('Packed Core runtime failed')

const webOnly = cloudflare({
  accountId: 'account', apiToken: 'token', webAnalytics: { siteTag: 'site' },
})
const cloudflareInsight = createInsight({ providers: [webOnly] })
const fullCloudflare = createInsight({ providers: [cloudflare({
  analyticsEngine: { dataset: 'events' }, webAnalytics: { siteTag: 'site' },
})] })
const searchInsight = createInsight({ providers: [googleSearchConsole({
  auth: { getAccessToken: async () => 'token' }, property: 'sc-domain:example.com',
})] })

async function verifyPublishedTypes() {
  const { traffic } = await cloudflareInsight.query((q) => ({
    traffic: q.metrics({
      dimensions: ['path'], metrics: ['pageViews'],
      time: { from: '2026-08-01T00:00:00.000Z', to: '2026-08-02T00:00:00.000Z' },
      where: { country: { in: ['JP'] } },
    }),
  }))
  const pageViews: number | null = traffic.data.values.pageViews
  void pageViews
  // @ts-expect-error an unconfigured canonical Metric is absent
  cloudflareInsight.query((q) => ({ invalid: q.metrics({ metrics: ['events'], time: { from: '', to: '' } }) }))
  // @ts-expect-error unsupported metric
  cloudflareInsight.query((q) => ({ invalid: q.metrics({ metrics: ['clicks'], time: { from: '', to: '' } }) }))
  // @ts-expect-error unsupported dimension
  cloudflareInsight.query((q) => ({ invalid: q.metrics({ dimensions: ['query'], metrics: ['visits'], time: { from: '', to: '' } }) }))

  fullCloudflare.query((q) => ({
    overview: q.metrics({ metrics: ['events', 'visits'], time: { from: '', to: '' } }),
  }))
  await searchInsight.query((q) => ({
    search: q.metrics({ metrics: ['clicks'], time: { from: '', to: '' } }),
  }))
}
void verifyPublishedTypes
`,
    },
    {
        dependencies: ['nuxt@4.5.2'],
        name: 'nuxt',
        nuxt: true,
        source: `import module, { type NuxtInsightModuleOptions } from 'insight-ts/nuxt'
const options: NuxtInsightModuleOptions = {}
if (typeof module !== 'function' || options.history) throw new Error('Packed Nuxt export failed')
`,
    },
    {
        dependencies: ['vue@3.5.42'],
        name: 'vue-integration',
        source: `import { createBrowserInsight } from 'insight-ts/browser'
import { provideBrowserInsight, useBrowserInsight } from 'insight-ts/vue'
import { createSSRApp, defineComponent, h } from 'vue'
import { renderToString } from 'vue/server-renderer'
const insight = createBrowserInsight({ fetch: globalThis.fetch })
let injected
const Child = defineComponent(() => { injected = useBrowserInsight(); return () => h('span', 'ok') })
await renderToString(createSSRApp(defineComponent(() => { provideBrowserInsight(insight); return () => h(Child) })))
if (injected !== insight) throw new Error('Packed Vue integration failed')
`,
    },
    vueUiConsumer('vue-ui-35', 'vue@3.5.42'),
    vueUiConsumer('vue-ui-36', 'vue@3.6.0-rc.6'),
]

try {
    const packed = await run(
        [process.execPath, 'pm', 'pack', '--destination', root, '--ignore-scripts', '--quiet'],
        packageRoot,
    )
    const filename = basename(packed.trim())
    if (!filename.endsWith('.tgz')) throw new Error('bun pm pack did not report a tarball')
    const tarball = join(root, filename)
    for (const consumer of consumers) await verifyConsumer(consumer, tarball)
} finally {
    await rm(root, { force: true, recursive: true })
}

function vueUiConsumer(name: string, vue: string): Consumer {
    return {
        dependencies: [vue, 'happy-dom@20.12.0'],
        name,
        source: `import { Window } from 'happy-dom'
const browser = new Window({ url: 'https://example.test' })
Object.assign(globalThis, {
  document: browser.document, window: browser, navigator: browser.navigator,
  Element: browser.Element, HTMLElement: browser.HTMLElement, Node: browser.Node, SVGElement: browser.SVGElement,
})
const { createSSRApp, h, nextTick } = await import('vue')
const { renderToString } = await import('vue/server-renderer')
const {
  InsightAreaChart, InsightBarChart, InsightBreakdownTable, InsightLineChart,
  InsightQualityNotice, InsightSparkline, InsightStat,
} = await import('insight-ts/vue/ui')
const data = {
  data: {
    points: [
      { dimensions: { country: 'JP' }, time: '2026-08-26T00:00:00.000Z', values: { visits: 9 } },
      { dimensions: { country: 'US' }, time: '2026-08-31T00:00:00.000Z', values: { visits: 12 } },
    ],
    values: { visits: 12 },
  },
  meta: {
    contributions: [],
    quality: { sampled: true, sampleRate: 0.5 },
    queriedAt: '2026-08-28T00:00:00.000Z',
    temporal: { grain: 'day' },
  },
} as const
const Root = () => h('main', [
  h(InsightStat, { data }),
  h(InsightLineChart, { data }),
  h(InsightAreaChart, { data }),
  h(InsightSparkline, { data }),
  h(InsightBarChart, { data, dimension: 'country' }),
  h(InsightBreakdownTable, { data }),
  h(InsightQualityNotice, { data: data.meta.quality }),
])
const html = await renderToString(createSSRApp(Root))
if ((html.match(/<svg/g) ?? []).length !== 3 || !html.includes('insight-chart__data insight-sr-only') || !html.includes('50% sampling')) throw new Error('Packed Vue SSR failed')
const container = document.createElement('div'); container.innerHTML = html; document.body.append(container)
const warnings: unknown[][] = []; const warn = console.warn; console.warn = (...args) => warnings.push(args)
const app = createSSRApp(Root); app.mount(container); await nextTick(); console.warn = warn
if (container.querySelectorAll('svg').length !== 3 || warnings.some(([message]) => String(message).includes('Hydration'))) {
  throw new Error('Packed Vue hydration failed')
}
app.unmount(); browser.close()
`,
    }
}

async function verifyConsumer(consumer: Consumer, tarball: string): Promise<void> {
    const directory = join(root, consumer.name)
    const temporary = join(directory, 'tmp')
    await mkdir(temporary, { recursive: true })
    await Bun.write(
        join(directory, 'package.json'),
        JSON.stringify({ name: consumer.name, private: true, type: 'module' }),
    )
    const env = {
        ...process.env,
        BUN_TMPDIR: temporary,
        TEMP: temporary,
        TMP: temporary,
        TMPDIR: temporary,
    }
    await run(
        [
            process.execPath,
            'add',
            tarball,
            '@types/bun@1.4.0',
            'typescript@6.0.3',
            ...(consumer.dependencies ?? []),
            '--backend=copyfile',
            '--cache-dir',
            cache,
            '--ignore-scripts',
        ],
        directory,
        env,
    )
    await Bun.write(
        join(directory, 'tsconfig.json'),
        JSON.stringify({
            compilerOptions: {
                lib: ['DOM', 'ES2022'],
                module: 'ESNext',
                moduleResolution: 'Bundler',
                noEmit: true,
                skipLibCheck: true,
                strict: true,
                target: 'ES2022',
                types: ['bun'],
            },
            include: ['verify.ts'],
        }),
    )
    await Bun.write(join(directory, 'verify.ts'), consumer.source)
    await run([process.execPath, 'x', 'tsc', '--noEmit'], directory, env)
    await run([process.execPath, 'run', 'verify.ts'], directory, env)

    if (consumer.nuxt) {
        await Bun.write(
            join(directory, 'nuxt.config.ts'),
            "export default defineNuxtConfig({ modules: ['insight-ts/nuxt'] })\n",
        )
        await Bun.write(join(directory, 'app.vue'), '<template><main>Packed Nuxt</main></template>')
        await run([process.execPath, 'x', 'nuxt', 'build'], directory, env)
        if (
            !(await exists(join(directory, '.output', 'server', 'index.mjs'))) ||
            !(await exists(join(directory, '.nuxt', 'insight', 'server.mjs')))
        ) {
            throw new Error('Packed Nuxt production build failed')
        }
    }
}

async function run(command: readonly string[], cwd: string, env = process.env): Promise<string> {
    const child = Bun.spawn([...command], { cwd, env, stderr: 'pipe', stdout: 'pipe' })
    const [code, stderr, stdout] = await Promise.all([
        child.exited,
        new Response(child.stderr).text(),
        new Response(child.stdout).text(),
    ])
    if (code !== 0) throw new Error(`${command.join(' ')} failed\n${stderr || stdout}`)
    return stdout
}

async function exists(path: string): Promise<boolean> {
    try {
        await access(path)
        return true
    } catch {
        return false
    }
}
