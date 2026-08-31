/* eslint-disable no-await-in-loop -- fixtures build sequentially to keep peak memory bounded */

import { cp, mkdir, mkdtemp, rm } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { basename, join, resolve } from 'node:path'
import { gzipSync } from 'node:zlib'

import Vue from 'unplugin-vue/vite'
import { build } from 'vite'

interface BundleMeasurement {
    gzip: number
    name: string
    raw: number
}

interface BundleReport {
    invariants: readonly string[]
    results: readonly BundleMeasurement[]
    version: 1
}

const cliArguments = process.argv.slice(2)
const output = option('--output')

if (cliArguments[0] === '--compare') {
    const base = await readReport(required(cliArguments[1], 'base report'))
    const head = await readReport(required(cliArguments[2], 'head report'))
    await emit(compare(base, head), output)
} else {
    const packageRoot = resolve(option('--package-root') ?? join(import.meta.dir, '..'))
    await emit(JSON.stringify(await measure(packageRoot), null, 2) + '\n', output)
}

async function measure(packageRoot: string): Promise<BundleReport> {
    const root = await mkdtemp(join(tmpdir(), 'insight-ts-bundles-'))
    try {
        const packed = await run(
            [process.execPath, 'pm', 'pack', '--destination', root, '--ignore-scripts', '--quiet'],
            packageRoot,
        )
        const filename = basename(packed.trim())
        if (!filename.endsWith('.tgz')) throw new Error('bun pm pack did not report a tarball')

        const consumer = join(root, 'consumer')
        const temporary = join(root, 'tmp')
        await mkdir(consumer, { recursive: true })
        await mkdir(temporary, { recursive: true })
        await cp(join(packageRoot, 'test', 'fixtures', 'bundle'), join(consumer, 'fixtures'), {
            recursive: true,
        })
        await Bun.write(
            join(consumer, 'package.json'),
            JSON.stringify({ name: 'insight-ts-bundle-consumer', private: true, type: 'module' }),
        )
        const cache = new TextDecoder()
            .decode(Bun.spawnSync([process.execPath, 'pm', 'cache']).stdout)
            .trim()
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
                join(root, filename),
                'nuxt@4.5.2',
                'vue@3.5.42',
                '--backend=copyfile',
                '--cache-dir',
                cache,
                '--ignore-scripts',
            ],
            consumer,
            env,
        )

        const entries = [
            'core.ts',
            'browser.ts',
            'metrics.ts',
            'history.ts',
            'ui-core.ts',
            'vue.ts',
            'vue-lite.ts',
            'vue-cartesian.ts',
            'vue-full.ts',
        ]
        const results: BundleMeasurement[] = []
        const modules = new Map<string, readonly string[]>()
        for (const entry of entries) {
            const name = entry.replace(/\.(?:ts|vue)$/, '')
            const built = await build({
                build: {
                    cssCodeSplit: false,
                    minify: 'esbuild',
                    rollupOptions: { input: join(consumer, 'fixtures', entry) },
                    target: 'es2022',
                    write: false,
                },
                configFile: false,
                logLevel: 'error',
                plugins: [Vue()],
                root: consumer,
            })
            if (!Array.isArray(built) && 'close' in built) {
                throw new Error('Vite unexpectedly started in watch mode')
            }
            const outputs = (Array.isArray(built) ? built : [built]).flatMap(
                (result) => result.output,
            )
            const files = outputs.flatMap((file) => {
                if ('code' in file) return [Buffer.from(file.code)]
                if (!/\.(?:css|js)$/.test(file.fileName)) return []
                return [
                    typeof file.source === 'string'
                        ? Buffer.from(file.source)
                        : Buffer.from(file.source),
                ]
            })
            results.push(size(name, files))
            modules.set(
                name,
                outputs.flatMap((file) => ('modules' in file ? Object.keys(file.modules) : [])),
            )
        }

        assertExcludes(
            modules,
            ['core', 'browser', 'metrics', 'history', 'ui-core'],
            [
                '/node_modules/vue/',
                '/node_modules/@tanstack/charts/',
                '/node_modules/d3-shape/',
                '/dist/vue-ui.js',
            ],
        )
        assertExcludes(
            modules,
            ['vue'],
            ['/node_modules/@tanstack/charts/', '/node_modules/d3-shape/', '/dist/vue-ui.js'],
        )
        assertExcludes(
            modules,
            ['vue-lite'],
            ['/node_modules/@tanstack/charts/', '/node_modules/d3-shape/'],
        )
        assertIncludes(modules, ['vue-cartesian', 'vue-full'], '/node_modules/@tanstack/charts/')

        const nuxt = join(consumer, 'fixtures', 'nuxt')
        await run([process.execPath, 'x', 'nuxt', 'build'], nuxt, {
            ...env,
            NITRO_PRESET: 'node_server',
        })
        const generated = await readText([join(nuxt, '.nuxt'), join(nuxt, '.output')])
        for (const forbidden of ['@tanstack/charts', 'InsightAreaChart', '--insight-chart-1']) {
            if (generated.includes(forbidden)) {
                throw new Error(`Nuxt module-only consumer contains Vue UI marker ${forbidden}`)
            }
        }
        const strip = [...allForms(consumer), ...allForms('node_modules/.cache/nuxt/')]
        results.push(
            await measureDirectory('nuxt-client', join(nuxt, '.output', 'public'), strip),
            await measureDirectory('nuxt-server', join(nuxt, '.output', 'server'), strip),
        )

        return {
            invariants: [
                'Core, Browser, Metrics, History, and UI Core exclude Vue and chart code',
                'Vue integration excludes Vue UI and chart code',
                'Lightweight Vue UI excludes chart dependencies',
                'Cartesian and full Vue UI include the chart renderer',
                'Nuxt module-only consumer excludes Vue UI client code',
            ],
            results,
            version: 1,
        }
    } finally {
        await rm(root, { force: true, recursive: true })
    }
}

async function measureDirectory(
    name: string,
    directory: string,
    strip: readonly string[],
): Promise<BundleMeasurement> {
    const files: Buffer[] = []
    for (const file of new Bun.Glob('**/*.{css,js,mjs}').scanSync({ cwd: directory })) {
        let text = await Bun.file(join(directory, file)).text()
        for (const pattern of strip) text = text.replaceAll(pattern, '')
        files.push(Buffer.from(text))
    }
    return size(name, files)
}

function size(name: string, files: readonly Buffer[]): BundleMeasurement {
    return {
        gzip: files.reduce((total, file) => total + gzipSync(file).byteLength, 0),
        name,
        raw: files.reduce((total, file) => total + file.byteLength, 0),
    }
}

function assertExcludes(
    modules: ReadonlyMap<string, readonly string[]>,
    entries: readonly string[],
    forbidden: readonly string[],
): void {
    for (const entry of entries) {
        const graph = normalize(modules.get(entry) ?? [])
        for (const dependency of forbidden) {
            if (graph.includes(dependency)) {
                throw new Error(`${entry} consumer includes forbidden dependency ${dependency}`)
            }
        }
    }
}

function assertIncludes(
    modules: ReadonlyMap<string, readonly string[]>,
    entries: readonly string[],
    expected: string,
): void {
    for (const entry of entries) {
        if (!normalize(modules.get(entry) ?? []).includes(expected)) {
            throw new Error(`${entry} consumer did not include expected dependency ${expected}`)
        }
    }
}

function normalize(modules: readonly string[]): string {
    return modules.join('\n').replaceAll('\\', '/')
}

async function readText(directories: readonly string[]): Promise<string> {
    const files = directories.flatMap((directory) =>
        [...new Bun.Glob('**/*.{css,js,json,mjs,ts}').scanSync({ cwd: directory })].map((file) =>
            join(directory, file),
        ),
    )
    return (await Promise.all(files.map((file) => Bun.file(file).text()))).join('\n')
}

function allForms(value: string): string[] {
    const normalized = value.replaceAll('\\', '/')
    const encoded = encodeURIComponent(normalized)
    return [value, normalized, encoded, encoded.replace(/\W/g, '_')]
}

function compare(base: BundleReport, head: BundleReport): string {
    const baseByName = new Map(base.results.map((result) => [result.name, result]))
    const rows = head.results.map((current) => {
        const previous = baseByName.get(current.name)
        if (!previous) {
            return `| ${current.name} | — | ${bytes(current.raw)} | — | — | ${bytes(current.gzip)} | — |`
        }
        return `| ${current.name} | ${bytes(previous.raw)} | ${bytes(current.raw)} | ${delta(previous.raw, current.raw)} | ${bytes(previous.gzip)} | ${bytes(current.gzip)} | ${delta(previous.gzip, current.gzip)} |`
    })
    return `## Consumer bundle sizes

| fixture | main raw | PR raw | Δ raw | main gzip | PR gzip | Δ gzip |
| --- | ---: | ---: | ---: | ---: | ---: | ---: |
${rows.join('\n')}

Size changes are informational. Dependency-boundary invariants still fail the bundle job.
`
}

function bytes(value: number): string {
    return `${(value / 1024).toFixed(1)} KiB`
}

function delta(base: number, head: number): string {
    const change = head - base
    if (change === 0) return '—'
    const formatted = Math.abs(change) < 1024 ? `${Math.abs(change)} B` : bytes(Math.abs(change))
    const percent =
        base === 0 ? '' : ` (${change > 0 ? '+' : ''}${((change / base) * 100).toFixed(1)}%)`
    return `${change > 0 ? '+' : '-'}${formatted}${percent}`
}

async function run(
    command: readonly string[],
    cwd: string,
    env: Readonly<Record<string, string | undefined>> = process.env,
): Promise<string> {
    const child = Bun.spawn([...command], { cwd, env, stderr: 'pipe', stdout: 'pipe' })
    const [code, stderr, stdout] = await Promise.all([
        child.exited,
        new Response(child.stderr).text(),
        new Response(child.stdout).text(),
    ])
    if (code !== 0) throw new Error(`${command.join(' ')} failed\n${stderr || stdout}`)
    return stdout
}

function option(name: string): string | undefined {
    const index = cliArguments.indexOf(name)
    return index === -1 ? undefined : cliArguments[index + 1]
}

function required(value: string | undefined, name: string): string {
    if (!value) throw new Error(`Missing ${name}`)
    return value
}

async function emit(value: string, path: string | undefined): Promise<void> {
    if (path) await Bun.write(path, value)
    else process.stdout.write(value)
}

async function readReport(path: string): Promise<BundleReport> {
    const value: unknown = JSON.parse(await Bun.file(path).text())
    if (!isBundleReport(value)) throw new Error(`Invalid bundle report: ${path}`)
    return value
}

function isBundleReport(value: unknown): value is BundleReport {
    return (
        isRecord(value) &&
        value.version === 1 &&
        Array.isArray(value.invariants) &&
        value.invariants.every((item) => typeof item === 'string') &&
        Array.isArray(value.results) &&
        value.results.every(isBundleMeasurement)
    )
}

function isBundleMeasurement(value: unknown): value is BundleMeasurement {
    return (
        isRecord(value) &&
        typeof value.name === 'string' &&
        typeof value.raw === 'number' &&
        typeof value.gzip === 'number'
    )
}

function isRecord(value: unknown): value is Record<PropertyKey, unknown> {
    return typeof value === 'object' && value !== null
}
