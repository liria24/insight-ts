/* eslint-disable no-await-in-loop, vitest/no-conditional-expect -- fixtures build sequentially */

import { access, readFile, readdir, rm } from 'node:fs/promises'
import { join } from 'node:path'
import { fileURLToPath } from 'node:url'

import { buildNuxt, loadNuxt } from 'nuxt/kit'
import { describe, expect, it } from 'vitest'

import {
    configureMaintenanceTask,
    configureR2Storage,
    requireStorageMount,
} from '../src/integrations/nuxt/nitro'
const fixturesDirectory = fileURLToPath(new URL('./fixtures/', import.meta.url))

const scenarios = [
    'nuxt-minimal',
    'nuxt-read-only',
    'nuxt-events',
    'nuxt-events-only',
    'nuxt-r2',
    'nuxt-r2-custom-base',
    'nuxt-existing-storage',
    'nuxt-custom-storage',
    'nuxt-no-ui',
    'nuxt-compat5',
] as const

describe('Nuxt capability fixtures', () => {
    it('builds only the runtime capabilities each fixture configures', async () => {
        for (const scenario of scenarios) {
            const directory = join(fixturesDirectory, scenario)
            const buildDirectory = join(directory, '.nuxt')
            const outputDirectory = join(directory, '.output')
            const nodeModulesDirectory = join(directory, 'node_modules')
            await cleanup([buildDirectory, outputDirectory, nodeModulesDirectory])

            const nuxt = await loadNuxt({ cwd: directory, ready: true })
            try {
                const initialStorage =
                    scenario === 'nuxt-existing-storage'
                        ? { 'analytics:archive': { driver: 'memory' } }
                        : scenario === 'nuxt-custom-storage'
                          ? { 'custom:archive': { driver: 'memory' } }
                          : {}
                const nitroConfig: Record<string, unknown> = { storage: initialStorage }
                if (
                    scenario === 'nuxt-r2' ||
                    scenario === 'nuxt-r2-custom-base' ||
                    scenario === 'nuxt-existing-storage'
                ) {
                    configureR2Storage(
                        nitroConfig,
                        scenario === 'nuxt-r2-custom-base' ? 'my-archive' : 'analytics:archive',
                        'ANALYTICS_ARCHIVE',
                    )
                }
                const hasArchive =
                    scenario === 'nuxt-r2' ||
                    scenario === 'nuxt-r2-custom-base' ||
                    scenario === 'nuxt-existing-storage' ||
                    scenario === 'nuxt-custom-storage'
                if (hasArchive) {
                    const base =
                        scenario === 'nuxt-custom-storage'
                            ? 'custom:archive'
                            : scenario === 'nuxt-r2-custom-base'
                              ? 'my-archive'
                              : 'analytics:archive'
                    requireStorageMount(nitroConfig, base)
                    configureMaintenanceTask(nitroConfig, 'analytics/maintenance.mjs')
                }
                await buildNuxt(nuxt)
                const hasRelay = scenario === 'nuxt-events'

                expect(await exists(join(buildDirectory, 'analytics/browser.ts'))).toBe(hasRelay)
                expect(await exists(join(buildDirectory, 'analytics/events.mjs'))).toBe(hasRelay)
                expect(await exists(join(buildDirectory, 'analytics/maintenance.mjs'))).toBe(
                    hasArchive,
                )

                if (scenario === 'nuxt-minimal') {
                    const runtimeTypes = await readFile(
                        join(buildDirectory, 'analytics/server-runtime.d.ts'),
                        'utf8',
                    )
                    const nitroImports = await readFile(
                        join(buildDirectory, 'types/nitro-imports.d.ts'),
                        'utf8',
                    )
                    expect(runtimeTypes).toContain(
                        "NuxtAnalyticsServerRuntime['useServerAnalytics']",
                    )
                    expect(runtimeTypes).toContain("NuxtAnalyticsServerRuntime['deliverEvents']")
                    expect(nitroImports).toContain(
                        "typeof import('../analytics/server-runtime.d').useServerAnalytics",
                    )
                    expect(nitroImports).toContain(
                        "typeof import('../analytics/server-runtime.d').deliverEvents",
                    )
                }

                expect(await exists(join(buildDirectory, 'analytics/vue.css'))).toBe(false)

                if (scenario === 'nuxt-read-only') {
                    const server = await readFile(
                        join(buildDirectory, 'analytics/server.mjs'),
                        'utf8',
                    )
                    expect(server).toContain('site-tag')
                    expect(server).toContain('sc-domain:example.com')
                    expect(server).toContain('providers?.googleSearchConsole?.getAccessToken')
                }

                if (
                    scenario === 'nuxt-r2' ||
                    scenario === 'nuxt-r2-custom-base' ||
                    scenario === 'nuxt-existing-storage' ||
                    scenario === 'nuxt-custom-storage'
                ) {
                    const storage = readRecord(nitroConfig.storage)
                    const tasks = readRecord(nitroConfig.tasks)
                    if (scenario === 'nuxt-custom-storage') {
                        expect(storage['custom:archive']).toEqual({ driver: 'memory' })
                    } else if (scenario === 'nuxt-r2-custom-base') {
                        expect(storage['my-archive']).toEqual({
                            binding: 'ANALYTICS_ARCHIVE',
                            driver: 'cloudflare-r2-binding',
                        })
                    } else {
                        expect(storage['analytics:archive']).toEqual(
                            scenario === 'nuxt-existing-storage'
                                ? { driver: 'memory' }
                                : {
                                      binding: 'ANALYTICS_ARCHIVE',
                                      driver: 'cloudflare-r2-binding',
                                  },
                        )
                    }
                    expect(tasks['analytics:maintenance']).toBeDefined()
                    expect(JSON.stringify(nitroConfig)).not.toContain('aws4fetch')
                }

                if (scenario === 'nuxt-no-ui' || scenario === 'nuxt-read-only') {
                    const output = await readBuildText([buildDirectory, outputDirectory])
                    expect(output).not.toContain('@tanstack/charts')
                    expect(output).not.toContain('@liria24/analytics/vue/ui')
                    expect(output).not.toContain('AnalyticsAreaChart')
                    expect(output).not.toContain('AnalyticsLineChart')
                    expect(output).not.toContain('ts-chart-surface')
                    expect(output).not.toContain('--analytics-chart-1')
                }

                if (scenario === 'nuxt-no-ui') {
                    const components = await readFile(
                        join(buildDirectory, 'components.d.ts'),
                        'utf8',
                    )
                    expect(components).not.toContain('AnalyticsStat')
                    expect(components).not.toContain('AnalyticsLineChart')
                    expect(components).not.toContain('@tanstack')
                }

                if (scenario === 'nuxt-minimal') {
                    const output = await readBuildText([buildDirectory, outputDirectory])
                    expect(output).toContain('analytics-area-chart')
                    expect(output).toContain('ts-chart-surface')
                    expect(output).toContain('--analytics-chart-1')
                }
            } finally {
                await nuxt.close()
                await cleanup([buildDirectory, outputDirectory, nodeModulesDirectory])
            }
        }
    }, 300_000)

    it.each([
        [
            'nuxt-archive-missing',
            'analytics.archive requires an existing Nitro Storage mount named "analytics:archive"',
        ],
        ['nuxt-relay-only', 'analytics.relay requires at least one analytics.events entry'],
    ])(
        'rejects invalid %s capability configuration',
        async (scenario, message) => {
            const directory = join(fixturesDirectory, scenario)
            const buildDirectory = join(directory, '.nuxt')
            const outputDirectory = join(directory, '.output')
            const nodeModulesDirectory = join(directory, 'node_modules')
            await cleanup([buildDirectory, outputDirectory, nodeModulesDirectory])

            await expect(async () => {
                const nuxt = await loadNuxt({ cwd: directory, ready: true })
                try {
                    await buildNuxt(nuxt)
                } finally {
                    await nuxt.close()
                }
            }).rejects.toThrow(message)
            await cleanup([buildDirectory, outputDirectory, nodeModulesDirectory])
        },
        120_000,
    )
})

async function exists(path: string): Promise<boolean> {
    try {
        await access(path)
        return true
    } catch {
        return false
    }
}

async function cleanup(directories: readonly string[]): Promise<void> {
    await Promise.all(
        directories.map((directory) => rm(directory, { force: true, recursive: true })),
    )
}

function readRecord(value: unknown): Record<string, unknown> {
    if (!isRecord(value)) throw new TypeError('Expected an object')
    return value
}

async function readBuildText(directories: readonly string[]): Promise<string> {
    const chunks: string[] = []
    for (const directory of directories) {
        if (!(await exists(directory))) continue
        for (const entry of await readdir(directory, { recursive: true, withFileTypes: true })) {
            if (!entry.isFile() || !/\.(?:css|js|json|mjs|ts)$/.test(entry.name)) continue
            chunks.push(await readFile(join(entry.parentPath, entry.name), 'utf8'))
        }
    }
    return chunks.join('\n')
}

function isRecord(value: unknown): value is Record<string, unknown> {
    return typeof value === 'object' && value !== null && !Array.isArray(value)
}
