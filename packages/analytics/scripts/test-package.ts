import { mkdir, mkdtemp, rm } from 'node:fs/promises'
import { basename, join } from 'node:path'

interface SpawnOptions {
    cwd: string
    env?: Readonly<Record<string, string>>
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

const workspace = join(import.meta.dir, '..', '..', '..')
const packageDirectory = join(workspace, 'packages', 'analytics')
const bunCacheDirectory = new TextDecoder()
    .decode(Bun.spawnSync([process.execPath, 'pm', 'cache']).stdout)
    .trim()
const temporaryRoot = join(workspace, '.tmp')
await mkdir(temporaryRoot, { recursive: true })
const consumer = await mkdtemp(join(temporaryRoot, 'liria-analytics-consumer-'))
const temporaryDirectory = join(consumer, 'tmp')
const temporaryInstall = join(consumer, '.bun-install')
await mkdir(temporaryDirectory, { recursive: true })
await mkdir(temporaryInstall, { recursive: true })
const temporaryEnvironment = {
    BUN_INSTALL: temporaryInstall,
    BUN_TMPDIR: temporaryDirectory,
    TEMP: temporaryRoot,
    TMP: temporaryRoot,
    TMPDIR: temporaryRoot,
}

try {
    const packOutput = await run(
        [process.execPath, 'pm', 'pack', '--destination', consumer, '--ignore-scripts', '--quiet'],
        { cwd: packageDirectory, env: temporaryEnvironment },
    )
    const filename = basename(packOutput.trim())
    if (!filename.endsWith('.tgz')) throw new Error('bun pm pack did not report a tarball')

    await Bun.write(
        join(consumer, 'package.json'),
        JSON.stringify({ name: 'packed-consumer', private: true, type: 'module' }),
    )
    await run(
        [
            process.execPath,
            'add',
            join(consumer, filename),
            'unstorage@1.17.5',
            'vue@3.5.41',
            '--backend=copyfile',
            '--cache-dir',
            bunCacheDirectory,
            '--omit=peer',
            '--ignore-scripts',
        ],
        {
            cwd: consumer,
            env: temporaryEnvironment,
        },
    )
    await Bun.write(
        join(consumer, 'verify.ts'),
        `import { createAnalytics } from '@liria24/analytics'
import { createBrowserAnalytics } from '@liria24/analytics/browser'
import { cloudflareWebAnalytics } from '@liria24/analytics/cloudflare'
import { googleSearchConsole } from '@liria24/analytics/google-search-console'
import {
    AnalyticsDashboard,
    AnalyticsKpiCard,
    AnalyticsSeriesChart,
} from '@liria24/analytics/vue'

if (
    typeof createAnalytics !== 'function' ||
    typeof createBrowserAnalytics !== 'function' ||
    typeof cloudflareWebAnalytics !== 'function' ||
    typeof googleSearchConsole !== 'function' ||
    typeof AnalyticsDashboard !== 'object' ||
    typeof AnalyticsKpiCard !== 'object' ||
    typeof AnalyticsSeriesChart !== 'object'
) {
    throw new Error('A packed public export is missing')
}
`,
    )
    await run([process.execPath, 'run', 'verify.ts'], { cwd: consumer })
} finally {
    await rm(consumer, { force: true, recursive: true })
}
