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

    it('returns the generated singleton before repeating runtime setup', async () => {
        const createInsight = vi.fn<(options: unknown) => unknown>((options) => options)
        const cloudflare = vi.fn<(options: unknown) => unknown>((options) => ({
            id: 'cloudflare',
            options,
        }))
        const useRuntimeConfig = vi.fn<() => object>(() => ({
            cloudflare: { accountId: 'account', apiToken: 'token', siteTag: 'site' },
        }))
        const useInsight = await evaluateRuntime(
            createServerRuntimeTemplate({ cloudflareWebAnalytics: true, history: false }),
            { cloudflare, config: { providers: [] }, createInsight, useRuntimeConfig },
        )

        const first = useInsight()
        expect(useInsight()).toBe(first)
        expect(useRuntimeConfig).toHaveBeenCalledOnce()
        expect(cloudflare).toHaveBeenCalledOnce()
        expect(createInsight).toHaveBeenCalledOnce()

        const scopedCreateInsight = vi.fn<(options: unknown) => unknown>((options) => options)
        const scoped = await evaluateRuntime(
            createServerRuntimeTemplate({ cloudflareWebAnalytics: false, history: false }),
            {
                config: { scopes: { production: [] } },
                createInsight: scopedCreateInsight,
            },
        )
        expect(scoped()).toBe(scoped())
        expect(scopedCreateInsight).toHaveBeenCalledOnce()
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
        const first = await repository.read({ ...target, limit: 1, range: segment.range })
        expect(first).toEqual({ next: expect.any(String), segments: [newer] })
        await expect(
            repository.read({
                ...target,
                cursor: first.next!,
                limit: 1,
                range: segment.range,
            }),
        ).resolves.toEqual({ segments: [segment] })
        expect(getItem).toHaveBeenCalledTimes(4)
    })

    it('only scans Nitro History partitions that overlap the requested range', async () => {
        const storage = createStorage({ driver: memoryDriver() })
        const repository = createNitroHistoryRepository(storage)
        const target = { adapter: 'app.logs', capability: 'logs', scope: 'default' }
        const ranges = Array.from({ length: 6 }, (_, index) => ({
            from: `2026-0${index + 1}-01T00:00:00.000Z`,
            to: `2026-0${index + 2}-01T00:00:00.000Z`,
        }))
        for (const [index, range] of ranges.entries()) {
            // Test setup intentionally persists separate physical partitions.
            // oxlint-disable-next-line no-await-in-loop
            await repository.replace({ ...target, range }, [
                {
                    ...target,
                    data: { id: `log-${index}` },
                    fidelity: { preservation: 'full', transformations: [] },
                    id: `segment-${index}`,
                    observedAt: range.to,
                    range,
                    schemaVersion: 2,
                    sortKey: range.from,
                },
            ])
        }
        const selected = ranges[2]!
        const getKeys = vi.spyOn(storage, 'getKeys')

        await expect(repository.coverage({ ...target, range: selected })).resolves.toHaveLength(1)
        expect(getKeys).not.toHaveBeenCalled()
        const selectedPage = await repository.read({ ...target, limit: 10, range: selected })
        expect(selectedPage).toMatchObject({ segments: [{ id: 'segment-2' }] })
        expect(getKeys).toHaveBeenCalledOnce()
        expect(getKeys.mock.calls[0]?.[0]).toContain(encodeURIComponent(selected.from))
        expect(getKeys.mock.calls[0]?.[0]).not.toContain(encodeURIComponent(ranges[0]!.from))

        getKeys.mockClear()
        await repository.replace({ ...target, range: selected }, selectedPage.segments)
        expect(getKeys).toHaveBeenCalledOnce()
        expect(getKeys.mock.calls[0]?.[0]).toContain(encodeURIComponent(selected.from))

        getKeys.mockClear()
        await repository.delete({ ...target, range: selected })
        expect(getKeys).toHaveBeenCalledOnce()
        await expect(repository.coverage({ ...target, range: ranges[3]! })).resolves.toHaveLength(1)

        const compactRange = { from: ranges[3]!.from, to: ranges[5]!.to }
        const retained = await repository.read({ ...target, limit: 10, range: compactRange })
        await repository.replace({ ...target, range: compactRange }, retained.segments)
        await expect(
            repository.read({ ...target, limit: 10, range: ranges[3]! }),
        ).resolves.toMatchObject({ segments: [{ id: 'segment-3' }] })

        await repository.replace({ ...target, range: ranges[3]! }, [
            {
                ...retained.segments.find(({ id }) => id === 'segment-3')!,
                id: 'replacement-3',
            },
        ])
        await expect(
            repository.read({ ...target, limit: 10, range: ranges[4]! }),
        ).resolves.toMatchObject({ segments: [{ id: 'segment-4' }] })
        await repository.delete({ ...target, range: ranges[4]! })
        await expect(
            repository.read({ ...target, limit: 10, range: ranges[5]! }),
        ).resolves.toMatchObject({ segments: [{ id: 'segment-5' }] })

        const partitionIndexKey = (await storage.getKeys()).find((key) =>
            key.endsWith(':partitions'),
        )
        expect(partitionIndexKey).toBeDefined()
        await storage.setItem(partitionIndexKey!, { schemaVersion: 2 })
        await expect(repository.coverage({ ...target, range: ranges[3]! })).rejects.toThrow(
            'invalid partition index',
        )
    })
})

const evaluateRuntime = (
    source: string,
    bindings: {
        cloudflare?: (options: unknown) => unknown
        config: object
        createInsight: (options: unknown) => unknown
        useRuntimeConfig?: () => unknown
    },
): Promise<() => unknown> => {
    const body = source
        .split('\n')
        .filter((line) => !line.startsWith('import '))
        .join('\n')
    const bindingName = '__insightRuntimeTest'
    Reflect.set(globalThis, bindingName, bindings)
    const runnable = `const { createInsight, config, cloudflare, useRuntimeConfig } = globalThis.${bindingName}\n${body}`
    return import(`data:text/javascript,${encodeURIComponent(runnable)}#${crypto.randomUUID()}`)
        .then((module: unknown) => {
            if (typeof module !== 'object' || module === null) throw new TypeError('Invalid module')
            const useInsight = Reflect.get(module, 'useInsight')
            if (typeof useInsight !== 'function') throw new TypeError('Missing useInsight')
            return () => Reflect.apply(useInsight, undefined, [])
        })
        .finally(() => Reflect.deleteProperty(globalThis, bindingName))
}
