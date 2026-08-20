import { readFile, rm } from 'node:fs/promises'
import { join } from 'node:path'
import { fileURLToPath } from 'node:url'

import { buildNuxt, loadNuxt } from 'nuxt/kit'
import { afterAll, describe, expect, it } from 'vitest'

const fixture = new URL('./fixtures/nuxt/', import.meta.url)
const fixtureDirectory = fileURLToPath(fixture)
const buildDirectory = join(fixtureDirectory, '.nuxt')
const outputDirectory = join(fixtureDirectory, '.output')
const fixtureNodeModulesDirectory = join(fixtureDirectory, 'node_modules')

afterAll(async () => {
    await Promise.all(
        [buildDirectory, outputDirectory, fixtureNodeModulesDirectory].map((directory) =>
            rm(directory, { force: true, recursive: true }),
        ),
    )
})

describe('Nuxt build fixture', () => {
    it('compiles generated browser, relay, server, task, and storage integration', async () => {
        const nuxt = await loadNuxt({
            cwd: fixtureDirectory,
            ready: true,
        })

        try {
            await buildNuxt(nuxt)

            const server = await readFile(join(buildDirectory, 'analytics/server.mjs'), 'utf8')
            const relay = await readFile(join(buildDirectory, 'analytics/events.mjs'), 'utf8')
            const browser = await readFile(join(buildDirectory, 'analytics/browser.ts'), 'utf8')
            const maintenance = await readFile(
                join(buildDirectory, 'analytics/maintenance.mjs'),
                'utf8',
            )

            expect(server).toContain('fixture-site-tag')
            expect(server).toContain('sc-domain:example.com')
            expect(server).toContain('ANALYTICS')
            expect(server).not.toContain('fixture-token')
            expect(relay).toContain('createAnalyticsEventHandler')
            expect(browser).toContain('useAnalytics')
            expect(maintenance).toContain("name: 'analytics:maintenance'")
            const nitro = readRecord(readRecord(nuxt.options).nitro)
            const storage = readRecord(nitro.storage)
            const tasks = readRecord(nitro.tasks)
            expect(storage['analytics:archive']).toMatchObject({
                binding: 'ANALYTICS_ARCHIVE',
                driver: 'cloudflare-r2-binding',
            })
            expect(tasks['analytics:maintenance']).toBeDefined()
        } finally {
            await nuxt.close()
        }
    }, 120_000)
})

function readRecord(value: unknown): Record<string, unknown> {
    if (!isRecord(value)) throw new TypeError('Expected an object')
    return value
}

function isRecord(value: unknown): value is Record<string, unknown> {
    return typeof value === 'object' && value !== null && !Array.isArray(value)
}
