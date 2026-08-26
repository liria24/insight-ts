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
    forbiddenPackages?: readonly string[]
    name: string
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
        forbiddenPackages: ['vue-data-ui', 'nuxt'],
        name: 'consumer-core',
        source: `import { createAnalytics } from '@liria24/analytics'
import { createBrowserAnalytics } from '@liria24/analytics/browser'
import { cloudflareWebAnalytics } from '@liria24/analytics/cloudflare'
import { googleSearchConsole } from '@liria24/analytics/google-search-console'

const analytics = createAnalytics({ adapters: [], name: 'packed-core' })
if (
    typeof analytics.query !== 'function' ||
    typeof createBrowserAnalytics !== 'function' ||
    typeof cloudflareWebAnalytics !== 'function' ||
    typeof googleSearchConsole !== 'function'
) throw new Error('A packed core or adapter export is missing')
`,
    },
    {
        dependencies: ['nuxt@4.5.2'],
        forbiddenPackages: ['vue-data-ui'],
        name: 'consumer-nuxt',
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
        dependencies: ['jspdf@4.2.1', 'vue@3.5.41', 'vue-data-ui@3.23.10'],
        name: 'consumer-vue',
        source: `import type { AnalyticsScalarReport } from '@liria24/analytics'
import {
    AnalyticsBreakdownTable,
    AnalyticsLineChart,
    AnalyticsStat,
} from '@liria24/analytics/vue'
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
const html = await renderToString(createSSRApp(() => h(AnalyticsStat, { metric: 'visits', report })))
if (
    !html.includes('12') ||
    typeof AnalyticsLineChart !== 'object' ||
    typeof AnalyticsBreakdownTable !== 'object'
) throw new Error('A packed Vue primitive is missing')
`,
    },
    {
        dependencies: ['nuxt@4.5.2'],
        forbiddenPackages: ['aws4fetch', 'vue-data-ui'],
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
        await run([process.execPath, 'run', 'verify.ts'], { cwd: directory, env: environment })
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
