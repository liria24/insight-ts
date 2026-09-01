import type {
    HistoryCoverage,
    HistoryRepository,
    HistorySegment,
    HistoryTarget,
} from '../../history/index.ts'

const mount = 'insight'
const historyPrefix = 'history:v3'

interface HistoryPartitionIndex {
    partitions: HistoryCoverage['range'][]
    schemaVersion: 3
}

interface HistoryCursor {
    id: string
    key: string
    sortKey: string
}

interface HistoryItemKey extends HistoryCursor {
    range: HistoryCoverage['range']
}

export interface NitroStorage {
    getItem(key: string): Promise<unknown>
    getKeys(base?: string): Promise<string[]>
    removeItem(key: string): Promise<void>
    setItem(key: string, value: unknown): Promise<void>
}

export const createNitroHistoryRepository = (storage: NitroStorage): HistoryRepository => {
    return {
        async coverage({ range, ...target }) {
            const partitions = await relevantPartitions(storage, target, range)
            const values = await Promise.all(
                partitions.map((partition) => storage.getItem(coverageKey(target, partition))),
            )
            return values.flatMap((value) => {
                if (value === null) return []
                if (!isHistoryCoverage(value)) {
                    throw new TypeError('Insight History storage contains invalid coverage')
                }
                return [value]
            })
        },
        async delete({ range, ...target }) {
            const index = await readIndex(storage, target)
            const retained = await Promise.all(
                index.partitions.map(async (partition) =>
                    overlaps(partition, range)
                        ? clearRange(storage, target, partition, range)
                        : true,
                ),
            )
            await writeIndex(storage, target, {
                ...index,
                partitions: index.partitions.filter((_, position) => retained[position]),
            })
        },
        async read({ cursor, limit, range, ...target }) {
            const partitions = await relevantPartitions(storage, target, range)
            const keys = (
                await Promise.all(
                    partitions.map(async (partition) => {
                        const prefix = itemPrefix(target, partition)
                        return (await storage.getKeys(prefix)).map((key) => ({
                            key,
                            ...itemKeyData(key, prefix),
                        }))
                    }),
                )
            )
                .flat()
                .filter((item) => overlaps(item.range, range))
                .toSorted(compareItems)
            const marker = cursor === undefined ? undefined : decodeCursor(cursor)
            const remaining = marker ? keys.filter((item) => compareItems(item, marker) > 0) : keys
            const pageKeys = remaining.slice(0, limit)
            const page = await Promise.all(pageKeys.map(({ key }) => storage.getItem(key)))
            const segments = page.flatMap((value) => {
                if (value === null) return []
                if (!isHistorySegment(value)) {
                    throw new TypeError('Insight History storage contains an invalid segment')
                }
                return [value]
            })
            return {
                ...(remaining.length > page.length && pageKeys.at(-1)
                    ? { next: encodeCursor(pageKeys.at(-1)!) }
                    : {}),
                segments,
            }
        },
        async replace({ range, ...target }, segments) {
            if (segments.some((segment) => !sameTarget(segment, target))) {
                throw new TypeError('Insight History replacement contains the wrong target')
            }
            const index = await readIndex(storage, target)
            const retained = await Promise.all(
                index.partitions.map(async (partition) =>
                    overlaps(partition, range)
                        ? clearRange(storage, target, partition, range)
                        : true,
                ),
            )
            await Promise.all(
                segments.map((segment) => storage.setItem(segmentKey(segment, range), segment)),
            )
            const first = segments[0]
            const coverage = first
                ? {
                      id: coverageId(target, range),
                      ...(first.provisional ? { provisional: true } : {}),
                      range,
                  }
                : undefined
            const nextCoverageKey = coverage ? coverageKey(target, coverage.range) : undefined
            if (coverage && nextCoverageKey) await storage.setItem(nextCoverageKey, coverage)
            await writeIndex(storage, target, {
                schemaVersion: 3,
                partitions: [
                    ...new Map(
                        [
                            ...index.partitions.filter((_, position) => retained[position]),
                            ...(segments.length > 0 ? [range] : []),
                        ].map((partition) => [rangeKey(partition), partition]),
                    ).values(),
                ].toSorted((left, right) => left.from.localeCompare(right.from)),
            })
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

const segmentKey = (segment: HistorySegment, partition: HistoryCoverage['range']): string =>
    `${itemPrefix(segment, partition)}${encodeURIComponent(segment.sortKey)}:${rangeKey(segment.range)}:${encodeURIComponent(segment.id)}`

const partitionPrefix = (target: HistoryTarget, range: HistoryCoverage['range']): string =>
    `${targetKey(target)}:partition:${rangeKey(range)}:`
const itemPrefix = (target: HistoryTarget, range: HistoryCoverage['range']): string =>
    `${partitionPrefix(target, range)}item:`
const coverageKey = (target: HistoryTarget, range: HistoryCoverage['range']): string =>
    `${partitionPrefix(target, range)}coverage`
const coverageId = (target: HistoryTarget, range: HistoryCoverage['range']): string =>
    `${target.scope}:${target.adapter}:${range.from}:${range.to}`
const indexKey = (target: HistoryTarget): string => `${targetKey(target)}:partitions`

const rangeKey = (range: HistoryCoverage['range']): string =>
    `${encodeURIComponent(range.from)}:${encodeURIComponent(range.to)}`

const itemKeyData = (key: string, keyPrefix: string): Omit<HistoryItemKey, 'key'> => {
    const parts = key.slice(keyPrefix.length).split(':')
    if (parts.length !== 4) throw new TypeError('Insight History storage contains an invalid key')
    return {
        id: decodeURIComponent(parts[3]!),
        range: { from: decodeURIComponent(parts[1]!), to: decodeURIComponent(parts[2]!) },
        sortKey: decodeURIComponent(parts[0]!),
    }
}

const compareItems = (left: HistoryCursor, right: HistoryCursor): number =>
    right.sortKey.localeCompare(left.sortKey) ||
    left.id.localeCompare(right.id) ||
    left.key.localeCompare(right.key)

const encodeCursor = ({ id, key, sortKey }: HistoryCursor): string =>
    JSON.stringify({ id, key, sortKey })

const decodeCursor = (cursor: string): HistoryCursor => {
    let value: unknown
    try {
        value = JSON.parse(cursor)
    } catch {
        throw new TypeError('Insight History storage received an invalid cursor')
    }
    if (
        !isRecord(value) ||
        typeof value.id !== 'string' ||
        typeof value.key !== 'string' ||
        typeof value.sortKey !== 'string'
    ) {
        throw new TypeError('Insight History storage received an invalid cursor')
    }
    return { id: value.id, key: value.key, sortKey: value.sortKey }
}

const readIndex = async (
    storage: NitroStorage,
    target: HistoryTarget,
): Promise<HistoryPartitionIndex> => {
    const value = await storage.getItem(indexKey(target))
    if (value === null) return { partitions: [], schemaVersion: 3 }
    if (!isPartitionIndex(value)) {
        throw new TypeError('Insight History storage contains an invalid partition index')
    }
    return value
}

const writeIndex = async (
    storage: NitroStorage,
    target: HistoryTarget,
    index: HistoryPartitionIndex,
): Promise<void> => {
    if (index.partitions.length === 0) await storage.removeItem(indexKey(target))
    else await storage.setItem(indexKey(target), index)
}

const relevantPartitions = async (
    storage: NitroStorage,
    target: HistoryTarget,
    range: HistoryCoverage['range'],
): Promise<HistoryCoverage['range'][]> =>
    (await readIndex(storage, target)).partitions.filter((partition) => overlaps(partition, range))

const clearRange = async (
    storage: NitroStorage,
    target: HistoryTarget,
    partition: HistoryCoverage['range'],
    range: HistoryCoverage['range'],
): Promise<boolean> => {
    const prefix = itemPrefix(target, partition)
    const keys = await storage.getKeys(prefix)
    const removed = keys.filter((key) => overlaps(itemKeyData(key, prefix).range, range))
    await Promise.all([
        ...removed.map((key) => storage.removeItem(key)),
        storage.removeItem(coverageKey(target, partition)),
    ])
    return removed.length < keys.length
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

const isPartitionIndex = (value: unknown): value is HistoryPartitionIndex =>
    isRecord(value) &&
    value.schemaVersion === 3 &&
    Array.isArray(value.partitions) &&
    value.partitions.every(
        (partition) =>
            isRecord(partition) &&
            typeof partition.from === 'string' &&
            typeof partition.to === 'string' &&
            partition.from < partition.to,
    )

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
