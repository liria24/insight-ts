import { createStorage } from 'unstorage'
import memoryDriver from 'unstorage/drivers/memory'
import { describe, expect, it, vi } from 'vitest'

import {
    createNitroHistoryRepository,
    configureNitroHistory,
} from '../src/integrations/nitro/index.ts'
import {
    createServerRuntimeTemplate,
    createServerRuntimeTypeTemplate,
} from '../src/integrations/nuxt/module.ts'

describe('Nitro and Nuxt integration', () => {
    it('only wires History into the generated server runtime when configured', () => {
        expect(
            createServerRuntimeTemplate({ cloudflareWebAnalytics: false, history: false }),
        ).not.toContain('insight-ts/history')
        const source = createServerRuntimeTemplate({
            cloudflareWebAnalytics: false,
            history: { capabilities: ['metrics'] },
        })
        expect(source).toContain("createNitroHistoryRepository(useStorage('insight'))")
        expect(source).toContain('capabilities: ["metrics"]')
        expect(source).not.toContain('h3')
    })

    it('configures Cloudflare from Nuxt runtime config with a typed Source', () => {
        const source = createServerRuntimeTemplate({
            cloudflareWebAnalytics: true,
            history: false,
        })
        expect(source).toContain('runtimeConfig.cloudflare')
        expect(source).not.toContain('runtimeConfig.insight')
        expect(source).toContain('cloudflare({')
        expect(source).not.toContain('CLOUDFLARE_API_TOKEN')

        const types = createServerRuntimeTypeTemplate({
            cloudflareWebAnalytics: true,
            history: false,
        })
        expect(types).toContain('ReturnType<typeof cloudflare<')
        expect(types).toContain('InsightClient<RuntimeConfig>')
        expect(types).not.toContain('any')
    })

    it('requires the well-known storage mount and keeps Tasks opt-in', () => {
        const config: Record<string, unknown> = { storage: { insight: { driver: 'memory' } } }
        configureNitroHistory(config)
        expect(config.tasks).toBeUndefined()
        expect(config.experimental).toBeUndefined()

        expect(() => configureNitroHistory({ storage: {} })).toThrow(
            'nitro.storage.insight or nitro.devStorage.insight',
        )
        expect(() => configureNitroHistory(config, { syncHandler: 'sync' })).toThrow(
            'Nitro Tasks must be explicitly enabled',
        )

        const withTasks: Record<string, unknown> = {
            experimental: { tasks: true },
            devStorage: { insight: { driver: 'fs' } },
        }
        configureNitroHistory(withTasks, { syncHandler: 'sync' })
        expect(withTasks.tasks).toMatchObject({
            'insight:history:sync': { handler: 'sync' },
        })
        expect(withTasks.experimental).toEqual({ tasks: true })
    })

    it('stores idempotent private History segments in Nitro Storage', async () => {
        const storage = createStorage({ driver: memoryDriver() })
        const repository = createNitroHistoryRepository(storage)
        const segment = {
            adapter: 'app.metrics',
            capability: 'metrics',
            fidelity: { preservation: 'full' as const, transformations: [] },
            id: 'app.usage:one',
            observedAt: '2026-08-28T00:00:00.000Z',
            range: { from: '2026-08-01T00:00:00.000Z', to: '2026-09-01T00:00:00.000Z' },
            data: {
                points: [],
                values: { requests: 0 },
            },
            schemaVersion: 2 as const,
            scope: 'default',
            sortKey: 'metrics',
        }
        const target = {
            adapter: segment.adapter,
            capability: segment.capability,
            scope: segment.scope,
        }
        const newer = { ...segment, id: 'app.usage:two', sortKey: 'newer' }
        await repository.replace({ ...target, range: segment.range }, [segment, newer])
        await repository.replace({ ...target, range: segment.range }, [segment, newer])

        expect(await repository.coverage({ ...target, range: segment.range })).toEqual([
            {
                id: `default:app.metrics:${segment.range.from}:${segment.range.to}`,
                range: segment.range,
            },
        ])
        const getItem = vi.spyOn(storage, 'getItem')
        expect(await repository.read({ ...target, limit: 1, range: segment.range })).toEqual({
            next: '1',
            segments: [newer],
        })
        expect(getItem).toHaveBeenCalledOnce()
    })
})
