/* eslint-disable no-await-in-loop -- Nuxt fixtures share compiler caches and build sequentially */

import { access, readFile, readdir, rm } from 'node:fs/promises'
import { join } from 'node:path'
import { fileURLToPath } from 'node:url'

import { buildNuxt, loadNuxt } from 'nuxt/kit'
import { describe, expect, it } from 'vitest'

const fixtures = fileURLToPath(new URL('./fixtures/', import.meta.url))

describe('Nuxt bundle isolation', () => {
    it.each([
        ['nuxt-no-ui', false, false],
        ['nuxt-minimal', true, false],
        ['nuxt-custom-storage', false, true],
    ] as const)(
        'builds %s with only configured capabilities',
        async (scenario, ui, history) => {
            const directory = join(fixtures, scenario)
            const generated = join(directory, '.nuxt')
            const output = join(directory, '.output')
            const fixtureModules = join(directory, 'node_modules')
            await cleanup([generated, output, fixtureModules])
            const nuxt = await loadNuxt({ cwd: directory, ready: true })
            try {
                await buildNuxt(nuxt)
                const text = await readBuildText([generated, output])
                expect(text.includes('@tanstack/charts')).toBe(ui)
                expect(text.includes('InsightAreaChart')).toBe(ui)
                expect(text.includes('--insight-chart-1')).toBe(ui)
                expect(text.includes("from 'insight-ts/history'")).toBe(history)
                expect(text).not.toContain('vue/ui/vapor')
                expect(text).not.toContain('vapor: true')
                expect(await exists(join(generated, 'analytics/vue.css'))).toBe(false)
                const runtimeTypes = await readFile(
                    join(generated, 'insight', 'server-runtime.d.ts'),
                    'utf8',
                )
                expect(runtimeTypes.includes("ProviderDefinition<'cloudflare'")).toBe(
                    scenario === 'nuxt-no-ui',
                )
                expect(runtimeTypes).toContain('InsightClient<RuntimeConfig>')
                expect(runtimeTypes).not.toContain('any')
            } finally {
                await nuxt.close()
                await cleanup([generated, output, fixtureModules])
            }
        },
        300_000,
    )

    it('fails explicitly when History has no Insight storage mount', async () => {
        const directory = join(fixtures, 'nuxt-history-missing')
        await expect(async () => {
            const nuxt = await loadNuxt({ cwd: directory, ready: true })
            try {
                await buildNuxt(nuxt)
            } finally {
                await nuxt.close()
            }
        }).rejects.toThrow('nitro.storage.insight or nitro.devStorage.insight')
        await cleanup([
            join(directory, '.nuxt'),
            join(directory, '.output'),
            join(directory, 'node_modules'),
        ])
    }, 120_000)
})

async function exists(path: string): Promise<boolean> {
    try {
        await access(path)
        return true
    } catch {
        return false
    }
}

async function cleanup(paths: readonly string[]): Promise<void> {
    await Promise.all(paths.map((path) => rm(path, { force: true, recursive: true })))
}

async function readBuildText(directories: readonly string[]): Promise<string> {
    const chunks: string[] = []
    for (const directory of directories) {
        if (!(await exists(directory))) continue
        for (const entry of await readdir(directory, { recursive: true, withFileTypes: true })) {
            if (entry.isFile() && /\.(?:css|js|json|mjs|ts)$/.test(entry.name)) {
                chunks.push(await readFile(join(entry.parentPath, entry.name), 'utf8'))
            }
        }
    }
    return chunks.join('\n')
}
