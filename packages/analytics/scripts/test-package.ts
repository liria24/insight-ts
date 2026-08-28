/* eslint-disable no-await-in-loop -- isolated consumers are intentionally verified sequentially */

import { access, mkdir, mkdtemp, rm } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { basename, join } from 'node:path'

interface SpawnOptions {
    cwd: string
    env?: Readonly<Record<string, string>>
}

interface Consumer {
    dependencies: readonly string[]
    expectsCss?: boolean
    forbiddenBundleText?: readonly string[]
    forbiddenPackages?: readonly string[]
    name: string
    nuxtBuild?: boolean
    source: string
}

async function run(command: readonly string[], options: SpawnOptions): Promise<string> {
    const child = Bun.spawn([...command], {
        cwd: options.cwd,
        env: { ...process.env, ...options.env },
        stderr: 'pipe',
        stdout: 'pipe',
    })
    const [exitCode, stderr, stdout] = await Promise.all([
        child.exited,
        new Response(child.stderr).text(),
        new Response(child.stdout).text(),
    ])
    if (exitCode !== 0) {
        throw new Error(`${command.join(' ')} failed\n${stderr || stdout}`)
    }
    return stdout
}

const consumers: readonly Consumer[] = [
    {
        dependencies: [],
        forbiddenBundleText: ['@tanstack/charts', 'AnalyticsAreaChart', '--analytics-chart-1'],
        forbiddenPackages: ['@unovis/ts', '@unovis/vue', 'vue-data-ui', 'nuxt'],
        name: 'consumer-core',
        source: `import { createAnalytics } from '@liria24/analytics'
import { createBrowserAnalytics } from '@liria24/analytics/browser'
import { cloudflareWebAnalytics } from '@liria24/analytics/cloudflare'
import { googleSearchConsole } from '@liria24/analytics/google-search-console'
import { defineAnalyticsProvider } from '@liria24/analytics/provider'

const custom = defineAnalyticsProvider({
    id: 'custom',
    sources: [{
        id: 'custom.traffic',
        domain: 'traffic',
        metrics: { pageViews: { aggregation: 'sum', rollup: 'additive', valueType: 'integer' } },
        dimensions: { time: { valueType: 'datetime' } },
        query: (_query, context) => context.summary({ values: { pageViews: 1 } }),
    }],
})
const analytics = createAnalytics({ name: 'packed-core', providers: [custom] })
if (
    typeof analytics.query !== 'function' ||
    analytics.sources()[0]?.id !== 'custom.traffic' ||
    typeof createBrowserAnalytics !== 'function' ||
    typeof cloudflareWebAnalytics !== 'function' ||
    typeof googleSearchConsole !== 'function'
) throw new Error('A packed core or adapter export is missing')
`,
    },
    {
        dependencies: ['nuxt@4.5.2', 'vue-tsc@3.3.11'],
        forbiddenBundleText: ['@tanstack/charts', 'AnalyticsAreaChart', '--analytics-chart-1'],
        forbiddenPackages: ['@unovis/ts', '@unovis/vue', 'vue-data-ui'],
        name: 'consumer-nuxt',
        nuxtBuild: true,
        source: `import analyticsModule, {
    type NuxtAnalyticsModuleOptions,
} from '@liria24/analytics/nuxt'

const options: NuxtAnalyticsModuleOptions = { name: 'packed-nuxt' }
if (!options.name || typeof analyticsModule !== 'function') {
    throw new Error('The packed Nuxt build-time entry is invalid')
}
`,
    },
    {
        dependencies: ['vue@3.5.41'],
        forbiddenBundleText: ['@tanstack/charts', 'AnalyticsAreaChart', '--analytics-chart-1'],
        forbiddenPackages: ['@unovis/ts', '@unovis/vue', 'vue-data-ui'],
        name: 'consumer-vue-integration',
        source: `import { createBrowserAnalytics } from '@liria24/analytics/browser'
import { provideAnalytics, useAnalytics } from '@liria24/analytics/vue'
import { createSSRApp, defineComponent, h } from 'vue'
import { renderToString } from 'vue/server-renderer'

const analytics = createBrowserAnalytics({ fetch: globalThis.fetch })
let injected
const Child = defineComponent(() => {
    injected = useAnalytics()
    return () => h('span', 'integration')
})
const html = await renderToString(createSSRApp(defineComponent(() => {
    provideAnalytics(analytics)
    return () => h(Child)
})))
if (!html.includes('integration') || injected !== analytics) {
    throw new Error('The packed Vue integration entry is invalid')
}
`,
    },
    {
        dependencies: ['vue@3.5.41'],
        expectsCss: true,
        name: 'consumer-vue-ui',
        source: `import type {
    AnalyticsScalarReport,
    AnalyticsSeriesReport,
    AnalyticsTableReport,
} from '@liria24/analytics'
import {
    AnalyticsAreaChart,
    AnalyticsBreakdownTable,
    AnalyticsLineChart,
    AnalyticsStat,
    type AnalyticsLineChartProps,
    type AnalyticsUIClass,
} from '@liria24/analytics/vue/ui'
import { createSSRApp, h } from 'vue'
import { renderToString } from 'vue/server-renderer'

const report: AnalyticsScalarReport = {
    kind: 'scalar',
    meta: {
        quality: {},
        queriedAt: '2026-08-20T00:00:00.000Z',
        source: 'packed-vue',
        temporal: {},
    },
    values: { visits: 12 },
}
const series: AnalyticsSeriesReport = {
    kind: 'series',
    meta: report.meta,
    points: [
        { time: '2026-08-19T00:00:00.000Z', values: { visits: 9 } },
        { time: '2026-08-20T00:00:00.000Z', values: { visits: 12 } },
    ],
}
const table: AnalyticsTableReport = {
    kind: 'table',
    meta: report.meta,
    rows: [{ dimensions: { country: 'JP' }, metrics: { visits: 12 } }],
}
const rootClass: AnalyticsUIClass = ['rounded', 'highlighted']
const chartProps: AnalyticsLineChartProps = { class: rootClass, report: series }
const style = await Bun.file(new URL(import.meta.resolve('@liria24/analytics/vue/ui/style.css'))).text()
const html = await renderToString(createSSRApp(() => h('main', [
    h(AnalyticsStat, { metric: 'visits', report }),
    h(AnalyticsLineChart, chartProps),
    h(AnalyticsAreaChart, { report: series }),
    h(AnalyticsBreakdownTable, { report: table }),
])))
if (
    !html.includes('12') ||
    !html.includes('<svg') ||
    chartProps.report !== series ||
    !style.includes('--analytics-chart-axis') ||
    typeof AnalyticsAreaChart !== 'object' ||
    typeof AnalyticsLineChart !== 'object' ||
    typeof AnalyticsBreakdownTable !== 'object'
) throw new Error('A packed Vue primitive is missing')
`,
    },
    {
        dependencies: ['nuxt@4.5.2'],
        forbiddenBundleText: ['@tanstack/charts', 'AnalyticsAreaChart', '--analytics-chart-1'],
        forbiddenPackages: ['@unovis/ts', '@unovis/vue', 'aws4fetch', 'vue-data-ui'],
        name: 'consumer-r2',
        source: `import analyticsModule, {
    type NuxtAnalyticsModuleOptions,
} from '@liria24/analytics/nuxt'

const options: NuxtAnalyticsModuleOptions = {
    name: 'packed-r2',
    providers: { cloudflare: { r2: 'ANALYTICS_ARCHIVE' } },
}
if (
    options.providers?.cloudflare?.r2 !== 'ANALYTICS_ARCHIVE' ||
    typeof analyticsModule !== 'function'
) throw new Error('The packed R2 configuration surface is invalid')
`,
    },
]

const workspace = join(import.meta.dir, '..', '..', '..')
const packageDirectory = join(workspace, 'packages', 'analytics')
const bunCacheDirectory = new TextDecoder()
    .decode(Bun.spawnSync([process.execPath, 'pm', 'cache']).stdout)
    .trim()
const packRoot = await mkdtemp(join(tmpdir(), 'liria-analytics-package-'))

try {
    const packOutput = await run(
        [process.execPath, 'pm', 'pack', '--destination', packRoot, '--ignore-scripts', '--quiet'],
        { cwd: packageDirectory },
    )
    const filename = basename(packOutput.trim())
    if (!filename.endsWith('.tgz')) throw new Error('bun pm pack did not report a tarball')
    const tarball = join(packRoot, filename)
    const packedFiles = await run(['tar', '-tf', tarball], { cwd: packRoot })
    if (!packedFiles.split(/\r?\n/).includes('package/dist/vue/ui/style.css')) {
        throw new Error('Packed Vue stylesheet is missing')
    }
    const packageManifest = await Bun.file(join(packageDirectory, 'package.json')).json()
    if (
        packageManifest.license !== 'MIT' ||
        packageManifest.dependencies?.['@tanstack/charts'] !== '0.16.0' ||
        packageManifest.dependencies?.['d3-shape'] !== '3.2.0' ||
        packageManifest.peerDependenciesMeta?.['@unovis/ts'] ||
        packageManifest.peerDependenciesMeta?.['@unovis/vue']
    ) {
        throw new Error('Package license or exact TanStack renderer dependencies are invalid')
    }
    const publicEntries = ['index.js', 'browser.js', 'nuxt.js', 'nuxt-runtime.js', 'vue.js']
    const nonUiDist = (
        await Promise.all(
            publicEntries.map((file) => Bun.file(join(packageDirectory, 'dist', file)).text()),
        )
    ).join('\n')
    if (
        nonUiDist.includes('@tanstack/charts') ||
        nonUiDist.includes('d3-shape') ||
        nonUiDist.includes('AnalyticsAreaChart') ||
        nonUiDist.includes('--analytics-chart-1')
    ) {
        throw new Error('A non-UI package entry depends on the UI renderer')
    }
    const distFiles = await Array.fromAsync(
        new Bun.Glob('**/*.{js,d.ts,css}').scan({ cwd: join(packageDirectory, 'dist') }),
    )
    const distText = (
        await Promise.all(
            distFiles.map((file) => Bun.file(join(packageDirectory, 'dist', file)).text()),
        )
    ).join('\n')
    if (distText.includes('vue-data-ui') || distText.includes('@unovis/')) {
        throw new Error('A removed chart renderer remains in dist')
    }
    const uiDeclaration = await Bun.file(join(packageDirectory, 'dist', 'vue-ui.d.ts')).text()
    const presentationDeclaration = await Bun.file(
        join(packageDirectory, 'dist', 'presentation.d.ts'),
    ).text()
    if (
        uiDeclaration.includes('@tanstack/charts') ||
        uiDeclaration.includes('ChartPoint') ||
        presentationDeclaration.includes('@tanstack/charts') ||
        presentationDeclaration.includes('vue')
    ) {
        throw new Error('Renderer or framework types leaked into a public declaration')
    }

    for (const consumer of consumers) {
        const directory = join(packRoot, consumer.name)
        const temporaryDirectory = join(directory, 'tmp')
        const temporaryInstall = join(directory, '.bun-install')
        await mkdir(temporaryDirectory, { recursive: true })
        await mkdir(temporaryInstall, { recursive: true })
        const environment = {
            BUN_INSTALL: temporaryInstall,
            BUN_TMPDIR: temporaryDirectory,
            TEMP: temporaryDirectory,
            TMP: temporaryDirectory,
            TMPDIR: temporaryDirectory,
        }

        await Bun.write(
            join(directory, 'package.json'),
            JSON.stringify({ name: consumer.name, private: true, type: 'module' }),
        )
        await run(
            [
                process.execPath,
                'add',
                tarball,
                '@types/bun@1.4.0',
                'typescript@6.0.3',
                ...consumer.dependencies,
                '--backend=copyfile',
                '--cache-dir',
                bunCacheDirectory,
                '--omit=peer',
                '--ignore-scripts',
            ],
            { cwd: directory, env: environment },
        )
        await Bun.write(
            join(directory, 'tsconfig.json'),
            JSON.stringify({
                compilerOptions: {
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

        for (const packageName of consumer.forbiddenPackages ?? []) {
            if (await exists(join(directory, 'node_modules', packageName))) {
                throw new Error(`${consumer.name} unexpectedly installed ${packageName}`)
            }
        }

        await run([process.execPath, 'x', 'tsc', '--noEmit'], {
            cwd: directory,
            env: environment,
        })
        await run([process.execPath, 'build', 'verify.ts', '--outdir', 'dist', '--target', 'bun'], {
            cwd: directory,
            env: environment,
        })
        const bundle = await Bun.file(join(directory, 'dist', 'verify.js')).text()
        for (const forbidden of consumer.forbiddenBundleText ?? []) {
            if (bundle.includes(forbidden)) {
                throw new Error(`${consumer.name} unexpectedly bundled ${forbidden}`)
            }
        }
        const cssPath = join(directory, 'dist', 'verify.css')
        if ((await exists(cssPath)) !== Boolean(consumer.expectsCss)) {
            throw new Error(`${consumer.name} emitted an unexpected CSS bundle state`)
        }
        if (consumer.expectsCss) {
            const css = await Bun.file(cssPath).text()
            if (!css.includes('--analytics-chart-1')) {
                throw new Error('The Vue UI entry did not include its base stylesheet')
            }
        }
        await run([process.execPath, 'run', 'verify.ts'], { cwd: directory, env: environment })

        if (consumer.nuxtBuild) {
            await Bun.write(
                join(directory, 'nuxt.config.ts'),
                `export default defineNuxtConfig({
  modules: ['@liria24/analytics/nuxt'],
  analytics: { name: 'packed-nuxt' },
})
`,
            )
            await Bun.write(
                join(directory, 'app.vue'),
                '<template><main>Packed Nuxt</main></template>',
            )
            const serverDirectory = join(directory, 'server', 'api')
            await mkdir(serverDirectory, { recursive: true })
            await Bun.write(
                join(serverDirectory, 'typed.get.ts'),
                `import type { AnalyticsClient } from '@liria24/analytics'
import type { NuxtAnalyticsServerEvent } from '@liria24/analytics/nuxt/runtime'

export default defineEventHandler(async (event) => {
  const pending: Promise<AnalyticsClient> = useServerAnalytics()
  const analytics: AnalyticsClient = await useServerAnalytics(event)
  await pending
  await analytics.query({
    metrics: ['pageViews'],
    range: { from: '2026-08-26T00:00:00.000Z', to: '2026-08-27T00:00:00.000Z' },
  })
  await analytics.track('pageViewed')
  await analytics.state.current('activeUsers')
  await analytics.maintenance.run()

  const events: readonly NuxtAnalyticsServerEvent[] = [{
    id: 'event-1',
    name: 'pageViewed',
    origin: 'client',
    properties: {},
    timestamp: '2026-08-27T00:00:00.000Z',
  }]
  await deliverEvents(events, event)

  // @ts-expect-error unknown methods must not be accepted through an any auto-import
  analytics.unknownMethod()
  // @ts-expect-error deliverEvents requires the H3 event
  await deliverEvents(events)
  return { ok: true }
})
`,
            )
            await run([process.execPath, 'x', 'nuxt', 'prepare'], {
                cwd: directory,
                env: environment,
            })
            await Bun.write(
                join(directory, 'tsconfig.json'),
                JSON.stringify({
                    files: [],
                    references: [
                        { path: './.nuxt/tsconfig.app.json' },
                        { path: './.nuxt/tsconfig.server.json' },
                        { path: './.nuxt/tsconfig.shared.json' },
                        { path: './.nuxt/tsconfig.node.json' },
                    ],
                }),
            )
            await run([process.execPath, 'x', 'nuxt', 'typecheck'], {
                cwd: directory,
                env: environment,
            })
            await run([process.execPath, 'x', 'nuxt', 'build'], {
                cwd: directory,
                env: environment,
            })
            const generatedRuntime = await Bun.file(
                join(directory, '.nuxt', 'analytics', 'server.mjs'),
            ).text()
            if (
                !(await exists(join(directory, '.output', 'server', 'index.mjs'))) ||
                !(await exists(join(directory, '.nuxt', 'analytics', 'server-runtime.d.ts'))) ||
                !generatedRuntime.includes("from '@liria24/analytics'")
            ) {
                throw new Error('The packed Nuxt application did not build its runtime templates')
            }
        }
    }
} finally {
    await rm(packRoot, { force: true, recursive: true })
}

async function exists(path: string): Promise<boolean> {
    try {
        await access(path)
        return true
    } catch {
        return false
    }
}
