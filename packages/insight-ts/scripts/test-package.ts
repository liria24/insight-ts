/* eslint-disable no-await-in-loop -- packed consumers intentionally run in isolated directories */

import { access, mkdir, mkdtemp, rm } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { basename, join } from 'node:path'

interface Consumer {
    dependencies?: readonly string[]
    expectsCss?: boolean
    forbidden?: readonly string[]
    name: string
    nuxt?: boolean
    source: string
}

const packageRoot = join(import.meta.dir, '..')
const cache = new TextDecoder()
    .decode(Bun.spawnSync([process.execPath, 'pm', 'cache']).stdout)
    .trim()
const root = await mkdtemp(join(tmpdir(), 'insight-ts-package-'))

async function verifyPackage(): Promise<void> {
    try {
        const packed = await run(
            [process.execPath, 'pm', 'pack', '--destination', root, '--ignore-scripts', '--quiet'],
            packageRoot,
        )
        const filename = basename(packed.trim())
        if (!filename.endsWith('.tgz')) throw new Error('bun pm pack did not report a tarball')
        const tarball = join(root, filename)
        const files = await run(['tar', '-tf', tarball], root)
        for (const required of ['package/dist/vue/ui/style.css', 'package/LICENSE']) {
            if (!files.split(/\r?\n/).includes(required))
                throw new Error(`Packed file missing: ${required}`)
        }

        const manifest = await Bun.file(join(packageRoot, 'package.json')).json()
        if (
            manifest.name !== 'insight-ts' ||
            manifest.license !== 'MIT' ||
            manifest.dependencies?.['@tanstack/charts'] !== '0.16.0' ||
            manifest.dependencies?.['d3-shape'] !== '3.2.0' ||
            manifest.peerDependencies?.vue !== '>=3.5.0'
        )
            throw new Error('Package identity, license, renderer pin, or Vue peer range is invalid')

        const isolatedEntries = [
            'index.js',
            'browser.js',
            'history.js',
            'nitro.js',
            'nuxt.js',
            'provider.js',
            'ui-core.js',
            'vue.js',
        ]
        const isolated = (
            await Promise.all(
                isolatedEntries.map((file) => Bun.file(join(packageRoot, 'dist', file)).text()),
            )
        ).join('\n')
        for (const forbidden of [
            '@tanstack/charts',
            'd3-shape',
            'InsightAreaChart',
            '--insight-chart-',
        ]) {
            if (isolated.includes(forbidden)) throw new Error(`Non-UI entry contains ${forbidden}`)
        }

        const declarations = await Promise.all([
            Bun.file(join(packageRoot, 'dist', 'vue-ui.d.ts')).text(),
            Bun.file(join(packageRoot, 'dist', 'ui-core.d.ts')).text(),
        ])
        if (
            declarations.some(
                (text) => text.includes('@tanstack/charts') || text.includes('ChartPoint'),
            )
        ) {
            throw new Error('Renderer types leaked into public declarations')
        }
        if (declarations[1].includes("from 'vue'"))
            throw new Error('UI Core declaration depends on Vue')

        for (const consumer of consumers) await verifyConsumer(consumer, tarball)
    } finally {
        await rm(root, { force: true, recursive: true })
    }
}

const consumers: readonly Consumer[] = [
    {
        forbidden: ['@tanstack/charts', 'd3-shape', 'InsightAreaChart', '--insight-chart-'],
        name: 'core',
        source: `import { createInsight } from 'insight-ts'
import { createBrowserInsight } from 'insight-ts/browser'
import { defineProvider } from 'insight-ts/provider'
import { createSeriesModel } from 'insight-ts/ui-core'

const provider = defineProvider({
  id: 'app',
  reports: { usage: {
    metrics: { views: { valueType: 'integer', aggregation: 'sum', rollup: 'additive' } },
    async series({ range }) { return { points: [{ time: range.from, values: { views: 3 } }] } },
  } },
})
const insight = createInsight({ providers: [provider] })
const report = await insight.reports('app.usage').series({
  metrics: ['views'], range: { from: '2026-08-01T00:00:00.000Z', to: '2026-08-02T00:00:00.000Z' },
})
if (createSeriesModel(report).series[0]?.values[0]?.value !== 3 || typeof createBrowserInsight !== 'function') {
  throw new Error('Packed Core/UI Core export failed')
}
`,
    },
    {
        dependencies: ['nuxt@4.5.2'],
        forbidden: ['@tanstack/charts', 'd3-shape', 'InsightAreaChart', '--insight-chart-'],
        name: 'nuxt',
        nuxt: true,
        source: `import module, { type NuxtInsightModuleOptions } from 'insight-ts/nuxt'
const options: NuxtInsightModuleOptions = {}
if (typeof module !== 'function' || options.history) throw new Error('Packed Nuxt export failed')
`,
    },
    {
        dependencies: ['vue@3.5.42'],
        forbidden: ['@tanstack/charts', 'd3-shape', 'InsightAreaChart', '--insight-chart-'],
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
    vueUiConsumer('vue-ui-36', 'vue@3.6.0-rc.2'),
]

function vueUiConsumer(name: string, vue: string): Consumer {
    return {
        dependencies: [vue, 'happy-dom@20.11.12'],
        expectsCss: true,
        name,
        source: `import { Window } from 'happy-dom'
const browser = new Window({ url: 'https://example.test' })
Object.assign(globalThis, {
  document: browser.document, window: browser, navigator: browser.navigator,
  Element: browser.Element, HTMLElement: browser.HTMLElement, Node: browser.Node, SVGElement: browser.SVGElement,
})
const { createSSRApp, h, nextTick } = await import('vue')
const { renderToString } = await import('vue/server-renderer')
const { InsightAreaChart, InsightLineChart, InsightStat } = await import('insight-ts/vue/ui')
const meta = { quality: {}, queriedAt: '2026-08-28T00:00:00.000Z', source: 'packed', temporal: { grain: 'day' } } as const
const scalar = { kind: 'scalar', meta, values: { visits: 12 } } as const
const series = { kind: 'series', meta, points: [
  { time: '2026-08-26T00:00:00.000Z', values: { visits: 9 } },
  { time: '2026-08-31T00:00:00.000Z', values: { visits: 12 } },
] } as const
const Root = () => h('main', [h(InsightStat, { metric: 'visits', report: scalar }), h(InsightLineChart, { report: series }), h(InsightAreaChart, { report: series })])
const html = await renderToString(createSSRApp(Root))
if ((html.match(/<svg/g) ?? []).length !== 2 || !html.includes('insight-chart__data insight-sr-only') || !html.includes('12')) throw new Error('Packed Vue SSR failed')
const container = document.createElement('div'); container.innerHTML = html; document.body.append(container)
const warnings: unknown[][] = []; const warn = console.warn; console.warn = (...args) => warnings.push(args)
const app = createSSRApp(Root); app.mount(container); await nextTick(); console.warn = warn
if (container.querySelectorAll('svg').length !== 2 || warnings.some(([message]) => String(message).includes('Hydration'))) {
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
    await run(
        [process.execPath, 'build', 'verify.ts', '--outdir', 'dist', '--target', 'bun'],
        directory,
        env,
    )
    const bundle = await Bun.file(join(directory, 'dist', 'verify.js')).text()
    for (const forbidden of consumer.forbidden ?? [])
        if (bundle.includes(forbidden)) throw new Error(`${consumer.name} bundled ${forbidden}`)
    const css = join(directory, 'dist', 'verify.css')
    if ((await exists(css)) !== Boolean(consumer.expectsCss))
        throw new Error(`${consumer.name} CSS isolation failed`)
    if (consumer.expectsCss && !(await Bun.file(css).text()).includes('--insight-chart-1'))
        throw new Error('Vue UI base CSS missing')
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
            throw new Error('Packed Nuxt build failed')
        }
        const output = await readTree([join(directory, '.nuxt'), join(directory, '.output')])
        for (const forbidden of consumer.forbidden ?? [])
            if (output.includes(forbidden)) throw new Error(`Packed Nuxt bundled ${forbidden}`)
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

async function readTree(directories: readonly string[]): Promise<string> {
    const files = directories.flatMap((directory) =>
        [...new Bun.Glob('**/*.{js,mjs,css,ts}').scanSync({ cwd: directory })].map((file) =>
            join(directory, file),
        ),
    )
    return (await Promise.all(files.map((file) => Bun.file(file).text()))).join('\n')
}

async function exists(path: string): Promise<boolean> {
    try {
        await access(path)
        return true
    } catch {
        return false
    }
}

await verifyPackage()
