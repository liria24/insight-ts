import type {
    HistoryCoverage,
    HistoryRepository,
    HistorySegment,
    HistoryTarget,
} from '../../history/index.ts'

const mount = 'insight'
const historyPrefix = 'history:v2'

export interface NitroStorage {
    getItem(key: string): Promise<unknown>
    getKeys(base?: string): Promise<string[]>
    removeItem(key: string): Promise<void>
    setItem(key: string, value: unknown): Promise<void>
}

export const createNitroHistoryRepository = (storage: NitroStorage): HistoryRepository => {
    return {
        async coverage({ range, ...target }) {
            const keys = (await storage.getKeys(coveragePrefix(target))).filter((key) =>
                overlaps(keyRange(key, coveragePrefix(target)), range),
            )
            const values = await Promise.all(keys.map((key) => storage.getItem(key)))
            return values.flatMap((value) => {
                if (value === null) return []
                if (!isHistoryCoverage(value)) {
                    throw new TypeError('Insight History storage contains invalid coverage')
                }
                return [value]
            })
        },
        async delete({ range, ...target }) {
            await removeOverlapping(storage, target, range)
        },
        async read({ cursor, limit, range, ...target }) {
            const itemsPrefix = itemPrefix(target)
            const keys = (await storage.getKeys(itemsPrefix))
                .map((key) => ({ key, ...itemKeyData(key, itemsPrefix) }))
                .filter((item) => overlaps(item.range, range))
                .toSorted(
                    (left, right) =>
                        right.sortKey.localeCompare(left.sortKey) ||
                        left.id.localeCompare(right.id),
                )
            const offset = cursor === undefined ? 0 : Number(cursor)
            if (!Number.isSafeInteger(offset) || offset < 0) {
                throw new TypeError('Insight History storage received an invalid cursor')
            }
            const pageKeys = keys.slice(offset, offset + limit)
            const page = await Promise.all(pageKeys.map(({ key }) => storage.getItem(key)))
            const segments = page.flatMap((value) => {
                if (value === null) return []
                if (!isHistorySegment(value)) {
                    throw new TypeError('Insight History storage contains an invalid segment')
                }
                return [value]
            })
            const next = offset + page.length
            return {
                ...(next < keys.length ? { next: String(next) } : {}),
                segments,
            }
        },
        async replace({ range, ...target }, segments) {
            if (segments.some((segment) => !sameTarget(segment, target))) {
                throw new TypeError('Insight History replacement contains the wrong target')
            }
            const replacementKeys = new Set(segments.map(segmentKey))
            await Promise.all(
                segments.map((segment) => storage.setItem(segmentKey(segment), segment)),
            )
            const first = segments[0]
            const coverage = first
                ? {
                      id: coverageId(target, range),
                      ...(first.provisional ? { provisional: true } : {}),
                      range,
                  }
                : undefined
            const nextCoverageKey = coverage ? coverageKey(target, coverage) : undefined
            if (coverage && nextCoverageKey) await storage.setItem(nextCoverageKey, coverage)

            const existingItems = await storage.getKeys(itemPrefix(target))
            const oldItems = existingItems.filter(
                (key) =>
                    overlaps(itemKeyData(key, itemPrefix(target)).range, range) &&
                    !replacementKeys.has(key),
            )
            const existingCoverage = await storage.getKeys(coveragePrefix(target))
            const oldCoverage = existingCoverage.filter(
                (key) =>
                    overlaps(keyRange(key, coveragePrefix(target)), range) &&
                    key !== nextCoverageKey,
            )
            await Promise.all([...oldItems, ...oldCoverage].map((key) => storage.removeItem(key)))
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

const removeOverlapping = async (
    storage: NitroStorage,
    target: HistoryTarget,
    range: HistoryCoverage['range'],
): Promise<void> => {
    const items = (await storage.getKeys(itemPrefix(target))).filter((key) =>
        overlaps(itemKeyData(key, itemPrefix(target)).range, range),
    )
    const coverage = (await storage.getKeys(coveragePrefix(target))).filter((key) =>
        overlaps(keyRange(key, coveragePrefix(target)), range),
    )
    await Promise.all([...items, ...coverage].map((key) => storage.removeItem(key)))
}

const segmentKey = (segment: HistorySegment): string =>
    `${itemPrefix(segment)}${encodeURIComponent(segment.sortKey)}:${rangeKey(segment.range)}:${encodeURIComponent(segment.id)}`

const itemPrefix = (target: HistoryTarget): string => `${targetKey(target)}:item:`
const coveragePrefix = (target: HistoryTarget): string => `${targetKey(target)}:coverage:`
const coverageKey = (target: HistoryTarget, coverage: HistoryCoverage): string =>
    `${coveragePrefix(target)}${rangeKey(coverage.range)}`
const coverageId = (target: HistoryTarget, range: HistoryCoverage['range']): string =>
    `${target.scope}:${target.adapter}:${range.from}:${range.to}`

const rangeKey = (range: HistoryCoverage['range']): string =>
    `${encodeURIComponent(range.from)}:${encodeURIComponent(range.to)}`

const keyRange = (key: string, keyPrefix: string): HistoryCoverage['range'] => {
    const parts = key.slice(keyPrefix.length).split(':')
    const from = parts.at(-2)
    const to = parts.at(-1)
    if (!from || !to) throw new TypeError('Insight History storage contains an invalid key')
    return { from: decodeURIComponent(from), to: decodeURIComponent(to) }
}

const itemKeyData = (key: string, keyPrefix: string) => {
    const parts = key.slice(keyPrefix.length).split(':')
    if (parts.length !== 4) throw new TypeError('Insight History storage contains an invalid key')
    return {
        id: decodeURIComponent(parts[3]!),
        range: { from: decodeURIComponent(parts[1]!), to: decodeURIComponent(parts[2]!) },
        sortKey: decodeURIComponent(parts[0]!),
    }
}

const targetKey = (target: HistoryTarget): string =>
    [
        historyPrefix,
        ...[target.scope, target.capability, target.adapter].map(encodeURIComponent),
    ].join(':')

const sameTarget = (left: HistoryTarget, right: HistoryTarget): boolean =>
    left.adapter === right.adapter &&
    left.capability === right.capability &&
    left.scope === right.scope

const overlaps = (left: HistoryCoverage['range'], right: HistoryCoverage['range']): boolean =>
    left.from < right.to && right.from < left.to

const record = (value: unknown, name: string): Record<string, unknown> => {
    if (!isRecord(value)) throw new TypeError(`${name} must be an object`)
    return value
}

const isRecord = (value: unknown): value is Record<string, unknown> =>
    typeof value === 'object' && value !== null && !Array.isArray(value)

const isHistoryCoverage = (value: unknown): value is HistoryCoverage =>
    isRecord(value) &&
    typeof value.id === 'string' &&
    isRecord(value.range) &&
    typeof value.range.from === 'string' &&
    typeof value.range.to === 'string' &&
    (value.provisional === undefined || typeof value.provisional === 'boolean')

const isHistorySegment = (value: unknown): value is HistorySegment => {
    if (!isRecord(value) || !isRecord(value.range) || !isRecord(value.fidelity)) return false
    return (
        typeof value.id === 'string' &&
        typeof value.adapter === 'string' &&
        typeof value.capability === 'string' &&
        typeof value.scope === 'string' &&
        typeof value.observedAt === 'string' &&
        typeof value.sortKey === 'string' &&
        value.schemaVersion === 2 &&
        typeof value.range.from === 'string' &&
        typeof value.range.to === 'string' &&
        (value.empty === true || value.data !== undefined) &&
        ['full', 'reduced', 'not-preserved'].includes(String(value.fidelity.preservation)) &&
        Array.isArray(value.fidelity.transformations)
    )
}
