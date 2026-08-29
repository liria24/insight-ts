import type { HistoryCoverage, HistoryRepository, HistorySegment } from '../../history/index.ts'

const mount = 'insight'
const prefix = 'history:v2'

export interface NitroStorage {
    getItem(key: string): Promise<unknown>
    getKeys(base?: string): Promise<string[]>
    setItem(key: string, value: unknown): Promise<void>
}

export const createNitroHistoryRepository = (storage: NitroStorage): HistoryRepository => {
    return {
        async coverage({ range, source }) {
            return (await readSegments(storage, source))
                .filter((segment) => overlaps(segment.range, range))
                .map(({ id, provisional, range: covered }) => ({
                    id,
                    ...(provisional ? { provisional } : {}),
                    range: covered,
                }))
        },
        async read({ range, source }) {
            return (await readSegments(storage, source)).filter((segment) =>
                overlaps(segment.range, range),
            )
        },
        async write(segment) {
            await storage.setItem(segmentKey(segment), segment)
        },
    }
}

export const configureNitroHistory = (
    nitroConfig: unknown,
    tasks?: { syncHandler: string },
): void => {
    const config = record(nitroConfig, 'Nitro config')
    const storage = isRecord(config.storage) ? config.storage : undefined
    const devStorage = isRecord(config.devStorage) ? config.devStorage : undefined
    if (!isRecord(storage?.[mount]) && !isRecord(devStorage?.[mount])) {
        throw new TypeError(
            'Insight History requires nitro.storage.insight or nitro.devStorage.insight',
        )
    }
    if (!tasks) return
    if (!isRecord(config.experimental) || config.experimental.tasks !== true) {
        throw new TypeError('Nitro Tasks must be explicitly enabled before Insight History tasks')
    }
    const configuredTasks =
        config.tasks === undefined ? (config.tasks = {}) : record(config.tasks, 'Nitro tasks')
    configuredTasks['insight:history:sync'] ??= {
        description: 'Synchronize missing Insight History ranges',
        handler: tasks.syncHandler,
    }
}

const readSegments = async (storage: NitroStorage, source: string): Promise<HistorySegment[]> => {
    const keys = await storage.getKeys(`${prefix}:${encodeURIComponent(source)}`)
    const segments = await Promise.all(keys.map((key) => storage.getItem(key)))
    return segments.flatMap((segment) => {
        if (segment === null) return []
        if (!isHistorySegment(segment)) {
            throw new TypeError('Insight History storage contains an invalid segment')
        }
        return [segment]
    })
}

const segmentKey = (segment: HistorySegment): string =>
    `${prefix}:${encodeURIComponent(segment.source)}:${encodeURIComponent(segment.id)}`

const overlaps = (left: HistoryCoverage['range'], right: HistoryCoverage['range']): boolean =>
    left.from < right.to && right.from < left.to

const record = (value: unknown, name: string): Record<string, unknown> => {
    if (!isRecord(value)) throw new TypeError(`${name} must be an object`)
    return value
}

const isRecord = (value: unknown): value is Record<string, unknown> =>
    typeof value === 'object' && value !== null && !Array.isArray(value)

const isHistorySegment = (value: unknown): value is HistorySegment => {
    if (!isRecord(value) || !isRecord(value.range) || !isRecord(value.fidelity)) return false
    if (!isRecord(value.data) || !isRecord(value.meta)) return false
    return (
        typeof value.id === 'string' &&
        typeof value.source === 'string' &&
        typeof value.observedAt === 'string' &&
        value.schemaVersion === 2 &&
        typeof value.range.from === 'string' &&
        typeof value.range.to === 'string' &&
        (value.fidelity.preservation === 'full' || value.fidelity.preservation === 'reduced') &&
        Array.isArray(value.fidelity.transformations)
    )
}
