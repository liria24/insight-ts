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
const temporaryRoot = join(workspace, '.tmp')
await mkdir(temporaryRoot, { recursive: true })
const consumer = await mkdtemp(join(temporaryRoot, 'liria-analytics-consumer-'))
const temporaryEnvironment = {
    BUN_INSTALL_CACHE_DIR: join(consumer, '.bun-cache'),
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
    await run([process.execPath, 'add', join(consumer, filename)], {
        cwd: consumer,
        env: temporaryEnvironment,
    })
    await Bun.write(
        join(consumer, 'verify.ts'),
        `import { createAnalytics } from '@liria24/analytics'
import { createBrowserAnalytics } from '@liria24/analytics/browser'
import { cloudflareWebAnalytics } from '@liria24/analytics/cloudflare'
import { googleSearchConsole } from '@liria24/analytics/google-search-console'

if (
    typeof createAnalytics !== 'function' ||
    typeof createBrowserAnalytics !== 'function' ||
    typeof cloudflareWebAnalytics !== 'function' ||
    typeof googleSearchConsole !== 'function'
) {
    throw new Error('A packed public export is missing')
}
`,
    )
    await run([process.execPath, 'run', 'verify.ts'], { cwd: consumer })
} finally {
    await rm(consumer, { force: true, recursive: true })
}
