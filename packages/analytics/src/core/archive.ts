/* eslint-disable no-await-in-loop -- partition coverage and writes are intentionally ordered */

import { recommendedArchiveStart } from './archive-metadata.ts'
import { AnalyticsError } from './errors.ts'
import { resolveRange } from './query.ts'
import type {
    AnalyticsAdapter,
    AnalyticsArchiveMaterialization,
    AnalyticsArchiveOptions,
    AnalyticsMaintenanceResult,
    AnalyticsMetricDescriptor,
    AnalyticsMetricValues,
    AnalyticsNormalizedStateValue,
    AnalyticsReport,
    AnalyticsReportQuality,
    AnalyticsSeriesPoint,
    AnalyticsSeriesReport,
    AnalyticsStateSeriesQuery,
    AnalyticsTableRow,
    AnalyticsWarning,
    ResolvedAnalyticsQuery,
} from './types.ts'

const schemaVersion = 1

function sorted<T>(values: readonly T[], compare?: (left: T, right: T) => number): T[] {
    const copy = [...values]
    // oxlint-disable-next-line unicorn/no-array-sort -- the published SDK targets ES2022.
    return copy.sort(compare)
}

interface ArchivePartition {
    environment: string
    generatedAt: string
    materialization: string
    project: string
    query: ResolvedAnalyticsQuery
    report: AnalyticsReport
    schemaVersion: typeof schemaVersion
    source: string
}

interface PartitionIndex {
    keys: readonly string[]
    schemaVersion: typeof schemaVersion
    start: string
}

interface StateObservation {
    timestamp: string
    values: Readonly<Record<string, AnalyticsNormalizedStateValue>>
}

interface StatePartition {
    environment: string
    materialization: 'observations'
    observations: readonly StateObservation[]
    project: string
    schemaVersion: typeof schemaVersion
    source: 'state'
}

interface StatePartitionIndex {
    keys: readonly string[]
    schemaVersion: typeof schemaVersion
}

interface ReportRow {
    dimensions: Record<string, boolean | number | string | null>
    metrics: AnalyticsMetricValues
    time?: string
}

function encodeKeyPart(value: string): string {
    return encodeURIComponent(value)
}

function monthStart(value: Date): Date {
    return new Date(Date.UTC(value.getUTCFullYear(), value.getUTCMonth(), 1))
}

function nextMonth(value: Date): Date {
    return new Date(Date.UTC(value.getUTCFullYear(), value.getUTCMonth() + 1, 1))
}

function monthId(value: Date): string {
    return value.toISOString().slice(0, 7)
}

function stateBucket(
    timestamp: string,
    grain: NonNullable<AnalyticsStateSeriesQuery['grain']>,
): string {
    const date = new Date(timestamp)
    date.setUTCHours(0, 0, 0, 0)
    if (grain === 'week') {
        const day = date.getUTCDay() || 7
        date.setUTCDate(date.getUTCDate() - day + 1)
    } else if (grain === 'month') {
        date.setUTCDate(1)
    } else if (grain === 'year') {
        date.setUTCMonth(0, 1)
    }
    return date.toISOString()
}

function isStateGrain(value: unknown): value is NonNullable<AnalyticsStateSeriesQuery['grain']> {
    return value === 'day' || value === 'week' || value === 'month' || value === 'year'
}

function reportBucket(timestamp: string, grain: ResolvedAnalyticsQuery['grain']): string {
    if (grain === 'auto') return timestamp
    const date = new Date(timestamp)
    if (!Number.isFinite(date.valueOf())) return timestamp
    if (grain === 'year') {
        date.setUTCMonth(0, 1)
        date.setUTCHours(0, 0, 0, 0)
    } else if (grain === 'month') {
        date.setUTCDate(1)
        date.setUTCHours(0, 0, 0, 0)
    } else if (grain === 'week') {
        date.setUTCHours(0, 0, 0, 0)
        const day = date.getUTCDay() || 7
        date.setUTCDate(date.getUTCDate() - day + 1)
    } else if (grain === 'day') {
        date.setUTCHours(0, 0, 0, 0)
    } else if (grain === 'hour') {
        date.setUTCMinutes(0, 0, 0)
    } else {
        date.setUTCSeconds(0, 0)
    }
    return date.toISOString()
}

function dateMax(left: Date, right: Date): Date {
    return left > right ? left : right
}

function dateMin(left: Date, right: Date): Date {
    return left < right ? left : right
}

function metricMap(adapter: AnalyticsAdapter): Map<string, AnalyticsMetricDescriptor> {
    return new Map(adapter.dataset.metrics.map((metric) => [metric.id, metric]))
}

function expandMetrics(
    metrics: readonly string[],
    descriptors: ReadonlyMap<string, AnalyticsMetricDescriptor>,
): string[] {
    const expanded = new Set(metrics)
    for (const metric of metrics) {
        const derive = descriptors.get(metric)?.derive
        if (derive) {
            expanded.add(derive.numerator)
            expanded.add(derive.denominator)
        }
    }
    return [...expanded]
}

function canRollup(
    metrics: readonly string[],
    descriptors: ReadonlyMap<string, AnalyticsMetricDescriptor>,
): boolean {
    return metrics.every((metric) => {
        const descriptor = descriptors.get(metric)
        if (!descriptor) return false
        if (descriptor.rollup === 'additive') return true
        if (descriptor.rollup !== 'derived' || !descriptor.derive) return false
        return [descriptor.derive.numerator, descriptor.derive.denominator].every(
            (supportingMetric) => descriptors.get(supportingMetric)?.rollup === 'additive',
        )
    })
}

function findMaterialization(
    adapter: AnalyticsAdapter,
    query: ResolvedAnalyticsQuery,
): AnalyticsArchiveMaterialization | undefined {
    if (query.filters || query.limit || query.timezone !== 'UTC') return undefined
    const descriptors = metricMap(adapter)
    const expanded = expandMetrics(query.metrics, descriptors)
    if (!canRollup(query.metrics, descriptors)) return undefined

    const grainOrder = ['minute', 'hour', 'day', 'week', 'month', 'year'] as const
    return adapter.dataset.archive?.find((materialization) => {
        const available = expandMetrics(materialization.metrics, descriptors)
        const materializedDimensions = materialization.dimensions ?? []
        const extraDimensions = materializedDimensions.filter(
            (dimension) => !query.dimensions.includes(dimension),
        )
        return (
            expanded.every((metric) => available.includes(metric)) &&
            query.dimensions.every((dimension) => materializedDimensions.includes(dimension)) &&
            extraDimensions.every((dimension) => {
                const valueType = adapter.dataset.dimensions.find(
                    ({ id }) => id === dimension,
                )?.valueType
                return valueType === 'date' || valueType === 'datetime'
            }) &&
            (query.grain === 'auto' ||
                (materialization.grain !== undefined &&
                    grainOrder.indexOf(materialization.grain) <= grainOrder.indexOf(query.grain)))
        )
    })
}

function rowsFromReport(report: AnalyticsReport): ReportRow[] {
    if (report.kind === 'scalar') {
        return [{ dimensions: {}, metrics: report.values }]
    }
    if (report.kind === 'series') {
        return report.points.map((point) => ({
            dimensions: {},
            metrics: point.values,
            time: point.time,
        }))
    }
    return report.rows.map((row) => ({ dimensions: row.dimensions, metrics: row.metrics }))
}

function sliceReport(
    report: AnalyticsReport,
    from: Date,
    to: Date,
    temporalDimension: string | undefined,
): AnalyticsReport | undefined {
    const retained = (timestamp: string): boolean => {
        const value = new Date(timestamp)
        return Number.isFinite(value.valueOf()) && value >= from && value < to
    }
    if (report.kind === 'series') {
        if (!report.points.every(({ time }) => Number.isFinite(new Date(time).valueOf()))) {
            return undefined
        }
        return { ...report, points: report.points.filter(({ time }) => retained(time)) }
    }
    if (report.kind === 'table' && temporalDimension) {
        const timestamps = report.rows.map(({ dimensions }) => dimensions[temporalDimension])
        if (
            !timestamps.every(
                (timestamp) =>
                    typeof timestamp === 'string' && Number.isFinite(new Date(timestamp).valueOf()),
            )
        ) {
            return undefined
        }
        return {
            ...report,
            rows: report.rows.filter(({ dimensions }) =>
                retained(String(dimensions[temporalDimension])),
            ),
        }
    }
    return undefined
}

function addMetric(target: AnalyticsMetricValues, metric: string, value: number | null): void {
    if (value === null) {
        target[metric] = null
        return
    }
    if (target[metric] === null) return
    target[metric] = (target[metric] ?? 0) + value
}

function deriveMetrics(
    values: AnalyticsMetricValues,
    metrics: readonly string[],
    descriptors: ReadonlyMap<string, AnalyticsMetricDescriptor>,
): AnalyticsMetricValues {
    const result: AnalyticsMetricValues = {}
    for (const metric of metrics) {
        const descriptor = descriptors.get(metric)
        if (descriptor?.rollup !== 'derived' || !descriptor.derive) {
            result[metric] = values[metric] ?? null
            continue
        }
        const numerator = values[descriptor.derive.numerator]
        const denominator = values[descriptor.derive.denominator]
        result[metric] =
            numerator === undefined || numerator === null || !denominator
                ? null
                : numerator / denominator
    }
    return result
}

function mergeQuality(
    reports: readonly AnalyticsReport[],
    imported: boolean,
): AnalyticsReportQuality {
    const qualities = reports.map(({ meta }) => meta.quality)
    const sampleRates = qualities.flatMap(({ sampleRate }) =>
        sampleRate === undefined ? [] : [sampleRate],
    )
    const hasNull = reports.some((report) =>
        rowsFromReport(report).some(({ metrics }) =>
            Object.values(metrics).some((value) => value === null),
        ),
    )
    const warnings = [
        ...qualities.flatMap(({ warnings: reportWarnings }) => reportWarnings ?? []),
        ...(hasNull
            ? [
                  {
                      code: 'null_metric_value',
                      message: 'At least one contributing metric value was unavailable',
                  },
              ]
            : []),
    ].filter(
        (warning, index, all) =>
            all.findIndex(
                (candidate) =>
                    candidate.code === warning.code && candidate.message === warning.message,
            ) === index,
    )
    return {
        ...(qualities.some(({ approximate }) => approximate) ? { approximate: true } : {}),
        ...(imported || qualities.some(({ imported: value }) => value) ? { imported: true } : {}),
        ...(hasNull || qualities.some(({ partial }) => partial) ? { partial: true } : {}),
        ...(qualities.some(({ sampled }) => sampled) ? { sampled: true } : {}),
        ...(sampleRates.length > 0 ? { sampleRate: Math.min(...sampleRates) } : {}),
        ...(qualities.some(({ thresholded }) => thresholded) ? { thresholded: true } : {}),
        ...(warnings.length > 0 ? { warnings } : {}),
    }
}

function mergeFreshness(
    reports: readonly AnalyticsReport[],
): AnalyticsReport['meta']['freshness'] | undefined {
    const completeThrough = sorted(
        reports.flatMap(({ meta }) =>
            meta.freshness?.completeThrough ? [meta.freshness.completeThrough] : [],
        ),
    )[0]
    const incompleteFrom = sorted(
        reports.flatMap(({ meta }) =>
            meta.freshness?.incompleteFrom ? [meta.freshness.incompleteFrom] : [],
        ),
    )[0]
    return completeThrough || incompleteFrom
        ? {
              ...(completeThrough ? { completeThrough } : {}),
              ...(incompleteFrom ? { incompleteFrom } : {}),
          }
        : undefined
}

function mergeReports(
    reports: readonly AnalyticsReport[],
    adapter: AnalyticsAdapter,
    query: ResolvedAnalyticsQuery,
    queriedAt: string,
    imported: boolean,
    materializationGrain?: AnalyticsArchiveMaterialization['grain'],
): AnalyticsReport {
    const descriptors = metricMap(adapter)
    const freshness = mergeFreshness(reports)
    const rollupGrain =
        query.grain !== 'auto' &&
        materializationGrain !== undefined &&
        query.grain !== materializationGrain
            ? query.grain
            : 'auto'
    const sourceTimezone = reports.find(({ meta }) => meta.temporal.sourceTimezone)?.meta.temporal
        .sourceTimezone
    const reportedBucketTimezones = [
        ...new Set(
            reports.flatMap(({ meta }) =>
                meta.temporal.bucketTimezone ? [meta.temporal.bucketTimezone] : [],
            ),
        ),
    ]
    const reportedBucketTimezone =
        reportedBucketTimezones.length === 1 ? reportedBucketTimezones[0] : undefined
    const bucketTimezone =
        rollupGrain === 'auto' ? (reportedBucketTimezone ?? query.timezone) : query.timezone
    const meta = {
        ...(freshness ? { freshness } : {}),
        quality: mergeQuality(reports, imported),
        queriedAt,
        source: query.source,
        temporal: {
            bucketTimezone,
            grain: query.grain,
            ...(sourceTimezone ? { sourceTimezone } : {}),
        },
    } as const

    const temporalDimension =
        query.dimensions.length === 1 &&
        ['date', 'datetime'].includes(
            adapter.dataset.dimensions.find(({ id }) => id === query.dimensions[0])?.valueType ??
                '',
        )
            ? query.dimensions[0]
            : undefined

    if (temporalDimension) {
        const grouped = new Map<string, AnalyticsMetricValues>()
        for (const row of reports.flatMap(rowsFromReport)) {
            const timestamp = row.time ?? String(row.dimensions[temporalDimension] ?? '')
            if (!timestamp) continue
            const time = reportBucket(timestamp, rollupGrain)
            const values = grouped.get(time) ?? {}
            for (const [metric, value] of Object.entries(row.metrics))
                addMetric(values, metric, value)
            grouped.set(time, values)
        }
        const points: AnalyticsSeriesPoint[] = sorted([...grouped], ([left], [right]) =>
            left.localeCompare(right),
        ).map(([time, values]) => ({
            time,
            values: deriveMetrics(values, query.metrics, descriptors),
        }))
        return {
            kind: 'series',
            meta,
            points: query.limit === undefined ? points : points.slice(0, query.limit),
        }
    }

    if (query.dimensions.length > 0) {
        const grouped = new Map<string, AnalyticsTableRow>()
        for (const row of reports.flatMap(rowsFromReport)) {
            const dimensions = Object.fromEntries(
                query.dimensions.map((dimension) => {
                    const value = row.dimensions[dimension] ?? null
                    const valueType = adapter.dataset.dimensions.find(
                        ({ id }) => id === dimension,
                    )?.valueType
                    return [
                        dimension,
                        typeof value === 'string' &&
                        (valueType === 'date' || valueType === 'datetime')
                            ? reportBucket(value, rollupGrain)
                            : value,
                    ]
                }),
            )
            const key = JSON.stringify(query.dimensions.map((dimension) => dimensions[dimension]))
            const current = grouped.get(key) ?? {
                dimensions,
                metrics: {},
            }
            for (const [metric, value] of Object.entries(row.metrics)) {
                addMetric(current.metrics, metric, value)
            }
            grouped.set(key, current)
        }
        const rows = [...grouped.values()].map((row) => ({
            dimensions: row.dimensions,
            metrics: deriveMetrics(row.metrics, query.metrics, descriptors),
        }))
        return {
            kind: 'table',
            meta,
            rows: query.limit === undefined ? rows : rows.slice(0, query.limit),
        }
    }

    const values: AnalyticsMetricValues = {}
    for (const row of reports.flatMap(rowsFromReport)) {
        for (const [metric, value] of Object.entries(row.metrics)) addMetric(values, metric, value)
    }
    return {
        kind: 'scalar',
        meta,
        values: deriveMetrics(values, query.metrics, descriptors),
    }
}

function isObject(value: unknown): value is Record<string, unknown> {
    return Boolean(value) && typeof value === 'object' && !Array.isArray(value)
}

function isMetricValues(value: unknown): value is AnalyticsMetricValues {
    return (
        isObject(value) &&
        Object.values(value).every(
            (metric) => metric === null || (typeof metric === 'number' && Number.isFinite(metric)),
        )
    )
}

function isReportMeta(value: unknown): value is AnalyticsReport['meta'] {
    if (
        !isObject(value) ||
        typeof value.queriedAt !== 'string' ||
        typeof value.source !== 'string' ||
        !isObject(value.quality) ||
        !isObject(value.temporal)
    ) {
        return false
    }
    const quality = value.quality
    for (const field of ['approximate', 'imported', 'partial', 'sampled', 'thresholded']) {
        if (field in quality && typeof quality[field] !== 'boolean') return false
    }
    if (
        ('sampleRate' in quality &&
            (typeof quality.sampleRate !== 'number' || !Number.isFinite(quality.sampleRate))) ||
        ('warnings' in quality &&
            (!Array.isArray(quality.warnings) ||
                !quality.warnings.every(
                    (warning) =>
                        isObject(warning) &&
                        typeof warning.code === 'string' &&
                        typeof warning.message === 'string',
                )))
    ) {
        return false
    }
    const temporal = value.temporal
    for (const field of ['bucketTimezone', 'grain', 'sourceTimezone']) {
        if (field in temporal && typeof temporal[field] !== 'string') return false
    }
    if ('freshness' in value) {
        if (!isObject(value.freshness)) return false
        for (const field of ['completeThrough', 'incompleteFrom']) {
            if (field in value.freshness && typeof value.freshness[field] !== 'string') return false
        }
    }
    return true
}

function isReport(value: unknown): value is AnalyticsReport {
    if (!isObject(value) || !isReportMeta(value.meta)) return false
    if (value.kind === 'scalar') return isMetricValues(value.values)
    if (value.kind === 'series') {
        return (
            Array.isArray(value.points) &&
            value.points.every(
                (point) =>
                    isObject(point) &&
                    typeof point.time === 'string' &&
                    Number.isFinite(new Date(point.time).valueOf()) &&
                    isMetricValues(point.values),
            )
        )
    }
    if (value.kind !== 'table' || !Array.isArray(value.rows)) return false
    return value.rows.every(
        (row) =>
            isObject(row) &&
            isObject(row.dimensions) &&
            Object.values(row.dimensions).every(
                (dimension) =>
                    dimension === null ||
                    typeof dimension === 'boolean' ||
                    typeof dimension === 'string' ||
                    (typeof dimension === 'number' && Number.isFinite(dimension)),
            ) &&
            isMetricValues(row.metrics),
    )
}

function isArchivePartition(value: unknown): value is ArchivePartition {
    if (!isObject(value)) return false
    if (
        value.schemaVersion !== schemaVersion ||
        typeof value.environment !== 'string' ||
        typeof value.project !== 'string' ||
        typeof value.source !== 'string' ||
        typeof value.materialization !== 'string' ||
        typeof value.generatedAt !== 'string' ||
        !isObject(value.query) ||
        !isReport(value.report)
    ) {
        return false
    }
    const query = value.query
    if (
        !Array.isArray(query.dimensions) ||
        !query.dimensions.every((dimension) => typeof dimension === 'string') ||
        !Array.isArray(query.metrics) ||
        !query.metrics.every((metric) => typeof metric === 'string') ||
        typeof query.grain !== 'string' ||
        typeof query.source !== 'string' ||
        typeof query.timezone !== 'string' ||
        !isObject(query.range)
    ) {
        return false
    }
    const range = query.range
    if (
        typeof range.from !== 'string' ||
        typeof range.to !== 'string' ||
        !Number.isFinite(new Date(range.from).valueOf()) ||
        !Number.isFinite(new Date(range.to).valueOf())
    ) {
        return false
    }
    return true
}

function isPartitionIndex(value: unknown): value is PartitionIndex {
    if (!value || typeof value !== 'object') return false
    return (
        'schemaVersion' in value &&
        value.schemaVersion === schemaVersion &&
        'keys' in value &&
        Array.isArray(value.keys) &&
        value.keys.every((key) => typeof key === 'string') &&
        'start' in value &&
        typeof value.start === 'string' &&
        Number.isFinite(new Date(value.start).valueOf())
    )
}

function isStatePartition(value: unknown): value is StatePartition {
    if (!isObject(value)) return false
    return (
        'schemaVersion' in value &&
        value.schemaVersion === schemaVersion &&
        'environment' in value &&
        typeof value.environment === 'string' &&
        'project' in value &&
        typeof value.project === 'string' &&
        'source' in value &&
        value.source === 'state' &&
        'materialization' in value &&
        value.materialization === 'observations' &&
        'observations' in value &&
        Array.isArray(value.observations) &&
        value.observations.every(
            (observation) =>
                Boolean(observation) &&
                typeof observation === 'object' &&
                'timestamp' in observation &&
                typeof observation.timestamp === 'string' &&
                Number.isFinite(new Date(observation.timestamp).valueOf()) &&
                'values' in observation &&
                isObject(observation.values) &&
                Object.values(observation.values).every(isNormalizedStateValue),
        )
    )
}

function isNormalizedStateValue(value: unknown): value is AnalyticsNormalizedStateValue {
    if (typeof value === 'number') return Number.isFinite(value)
    return (
        Array.isArray(value) &&
        value.every(
            (row) =>
                isObject(row) &&
                typeof row.value === 'number' &&
                Number.isFinite(row.value) &&
                Object.entries(row).every(
                    ([dimension, dimensionValue]) =>
                        dimension === 'value' ||
                        typeof dimensionValue === 'boolean' ||
                        typeof dimensionValue === 'string' ||
                        (typeof dimensionValue === 'number' && Number.isFinite(dimensionValue)),
                ),
        )
    )
}

function isStatePartitionIndex(value: unknown): value is StatePartitionIndex {
    if (!value || typeof value !== 'object') return false
    return (
        'schemaVersion' in value &&
        value.schemaVersion === schemaVersion &&
        'keys' in value &&
        Array.isArray(value.keys) &&
        value.keys.every((key) => typeof key === 'string')
    )
}

function trimPartition(
    partition: ArchivePartition,
    cutoff: Date,
    temporalDimension: string | undefined,
): ArchivePartition | undefined {
    if (new Date(partition.query.range.from) >= cutoff) return partition
    const retained = (timestamp: string): boolean => {
        const value = new Date(timestamp)
        return Number.isFinite(value.valueOf()) && value >= cutoff
    }
    const report = partition.report
    if (report.kind === 'series') {
        if (!report.points.every(({ time }) => Number.isFinite(new Date(time).valueOf())))
            return undefined
        return {
            ...partition,
            query: {
                ...partition.query,
                range: { ...partition.query.range, from: cutoff.toISOString() },
            },
            report: { ...report, points: report.points.filter(({ time }) => retained(time)) },
        }
    }
    if (report.kind === 'table' && temporalDimension) {
        const timestamps = report.rows.map(({ dimensions }) => dimensions[temporalDimension])
        if (
            !timestamps.every(
                (timestamp) =>
                    typeof timestamp === 'string' && Number.isFinite(new Date(timestamp).valueOf()),
            )
        ) {
            return undefined
        }
        return {
            ...partition,
            query: {
                ...partition.query,
                range: { ...partition.query.range, from: cutoff.toISOString() },
            },
            report: {
                ...report,
                rows: report.rows.filter(({ dimensions }) =>
                    retained(String(dimensions[temporalDimension])),
                ),
            },
        }
    }
    return undefined
}

export class AnalyticsArchive {
    readonly #environment: string
    readonly #name: string
    readonly #now: () => Date
    readonly #options: AnalyticsArchiveOptions

    constructor(
        name: string,
        environment: string,
        options: AnalyticsArchiveOptions,
        now: () => Date,
    ) {
        this.#name = name
        this.#environment = environment
        this.#options = options
        this.#now = now
    }

    #baseKey(source: string, materialization: string): string {
        return [
            'analytics',
            'v1',
            encodeKeyPart(this.#name),
            encodeKeyPart(this.#environment),
            encodeKeyPart(source),
            encodeKeyPart(materialization),
        ].join(':')
    }

    #partitionKey(source: string, materialization: string, month: Date): string {
        return `${this.#baseKey(source, materialization)}:${monthId(month)}`
    }

    async #read(
        key: string,
        source: string,
        materialization: string,
    ): Promise<ArchivePartition | null> {
        const value = await this.#options.storage.getItem<unknown>(key)
        if (value === null) return null
        if (
            !isArchivePartition(value) ||
            value.project !== this.#name ||
            value.environment !== this.#environment ||
            value.source !== source ||
            value.materialization !== materialization
        ) {
            throw new AnalyticsError(
                'ARCHIVE_CORRUPT',
                `Invalid analytics archive partition: ${key}`,
            )
        }
        return value
    }

    async #readState(key: string): Promise<StatePartition | null> {
        const value = await this.#options.storage.getItem<unknown>(key)
        if (value === null) return null
        if (
            !isStatePartition(value) ||
            value.project !== this.#name ||
            value.environment !== this.#environment
        ) {
            throw new AnalyticsError('ARCHIVE_CORRUPT', `Invalid state archive partition: ${key}`)
        }
        return value
    }

    async maintainState(
        values: Readonly<Record<string, AnalyticsNormalizedStateValue>>,
    ): Promise<AnalyticsMaintenanceResult> {
        const now = this.#now()
        const baseKey = this.#baseKey('state', 'observations')
        const indexKey = `${baseKey}:index`
        const key = this.#partitionKey('state', 'observations', now)
        const existing = await this.#readState(key)
        const day = now.toISOString().slice(0, 10)
        const observation: StateObservation = { timestamp: now.toISOString(), values }
        const observations = sorted(
            [
                ...(existing?.observations ?? []).filter(
                    ({ timestamp }) => !timestamp.startsWith(day),
                ),
                observation,
            ],
            (left, right) => left.timestamp.localeCompare(right.timestamp),
        )
        await this.#options.storage.setItem(key, {
            environment: this.#environment,
            materialization: 'observations',
            observations,
            project: this.#name,
            schemaVersion,
            source: 'state',
        } satisfies StatePartition)

        const isMonthlyPartitionKey = (partitionKey: string) =>
            partitionKey.startsWith(`${baseKey}:`) &&
            /^\d{4}-\d{2}$/.test(partitionKey.slice(baseKey.length + 1))
        const storedIndex = await this.#options.storage.getItem<unknown>(indexKey)
        const parsedIndex = isStatePartitionIndex(storedIndex) ? storedIndex : undefined
        const index = parsedIndex?.keys.every(isMonthlyPartitionKey) ? parsedIndex : undefined
        const discoveredKeys = (await this.#options.storage.getKeys(baseKey)).filter(
            isMonthlyPartitionKey,
        )
        const keys = new Set([...(index?.keys ?? []), ...discoveredKeys])
        keys.add(key)
        let pruned = 0
        if (this.#options.retention) {
            const cutoff = new Date(resolveRange(this.#options.retention, now).from)
            for (const partitionKey of keys) {
                const partition = await this.#readState(partitionKey)
                if (!partition) continue
                const retained = partition.observations.filter(
                    ({ timestamp }) => new Date(timestamp) >= cutoff,
                )
                if (retained.length === 0) {
                    await this.#options.storage.removeItem(partitionKey)
                    keys.delete(partitionKey)
                    pruned += 1
                } else if (retained.length !== partition.observations.length) {
                    await this.#options.storage.setItem(partitionKey, {
                        ...partition,
                        observations: retained,
                    } satisfies StatePartition)
                    pruned += 1
                }
            }
        }
        await this.#options.storage.setItem(indexKey, {
            keys: sorted([...keys]),
            schemaVersion,
        } satisfies StatePartitionIndex)
        return { pruned, refreshed: 1 }
    }

    async stateSeries(
        metric: string,
        query: AnalyticsStateSeriesQuery,
    ): Promise<AnalyticsSeriesReport> {
        if ((query.timezone ?? 'UTC') !== 'UTC') {
            throw new AnalyticsError('INVALID_QUERY', 'Application State history only supports UTC')
        }
        const grain = query.grain ?? 'day'
        if (!isStateGrain(grain)) {
            throw new AnalyticsError(
                'INVALID_QUERY',
                'Application State history only supports day, week, month, or year grain',
            )
        }
        const now = this.#now()
        const range = resolveRange(query.range, now)
        const from = new Date(range.from)
        const to = new Date(range.to)
        const observations: StateObservation[] = []
        for (let month = monthStart(from); month < to; month = nextMonth(month)) {
            const partition = await this.#readState(
                this.#partitionKey('state', 'observations', month),
            )
            if (!partition) continue
            observations.push(
                ...partition.observations.filter(({ timestamp }) => {
                    const observedAt = new Date(timestamp)
                    return observedAt >= from && observedAt < to
                }),
            )
        }
        const buckets = new Map<string, AnalyticsNormalizedStateValue>()
        for (const observation of sorted(observations, (left, right) =>
            left.timestamp.localeCompare(right.timestamp),
        )) {
            const value = observation.values[metric]
            if (value !== undefined) buckets.set(stateBucket(observation.timestamp, grain), value)
        }
        return {
            kind: 'series',
            meta: {
                quality: { imported: true },
                queriedAt: now.toISOString(),
                source: 'state',
                temporal: { bucketTimezone: 'UTC', grain, sourceTimezone: 'UTC' },
            },
            points: sorted([...buckets], ([left], [right]) => left.localeCompare(right)).flatMap(
                ([time, value]) =>
                    typeof value === 'number'
                        ? [{ time, values: { [metric]: value } }]
                        : value.map(({ value: metricValue, ...dimensions }) => ({
                              dimensions,
                              time,
                              values: { [metric]: metricValue },
                          })),
            ),
        }
    }

    async query(
        adapter: AnalyticsAdapter,
        query: ResolvedAnalyticsQuery,
    ): Promise<AnalyticsReport> {
        const materialization = findMaterialization(adapter, query)
        if (!materialization) {
            adapter.validate?.(query)
            return adapter.query(query)
        }

        const from = new Date(query.range.from)
        const to = new Date(query.range.to)
        const archived: AnalyticsReport[] = []
        const liveRanges: { from: Date; to: Date }[] = []
        const addLiveRange = (rangeFrom: Date, rangeTo: Date) => {
            if (rangeFrom >= rangeTo) return
            const previous = liveRanges.at(-1)
            if (previous && previous.to.valueOf() === rangeFrom.valueOf()) {
                previous.to = rangeTo
            } else {
                liveRanges.push({ from: rangeFrom, to: rangeTo })
            }
        }
        const temporalDimensions = (materialization.dimensions ?? []).filter((dimension) => {
            const valueType = adapter.dataset.dimensions.find(
                ({ id }) => id === dimension,
            )?.valueType
            return valueType === 'date' || valueType === 'datetime'
        })
        const temporalDimension =
            temporalDimensions.length === 1 ? temporalDimensions[0] : undefined

        for (let month = monthStart(from); month < to; month = nextMonth(month)) {
            const requestedFrom = dateMax(from, month)
            const requestedTo = dateMin(to, nextMonth(month))
            const partition = await this.#read(
                this.#partitionKey(adapter.dataset.id, materialization.id, month),
                adapter.dataset.id,
                materialization.id,
            )
            if (!partition) {
                addLiveRange(requestedFrom, requestedTo)
                continue
            }
            const partitionFrom = new Date(partition.query.range.from)
            const partitionTo = new Date(partition.query.range.to)
            if (
                !Number.isFinite(partitionFrom.valueOf()) ||
                !Number.isFinite(partitionTo.valueOf()) ||
                partitionFrom < month ||
                partitionFrom >= partitionTo ||
                partitionTo > nextMonth(month)
            ) {
                throw new AnalyticsError(
                    'ARCHIVE_CORRUPT',
                    `Invalid analytics archive coverage: ${monthId(month)}`,
                )
            }
            const coverageFrom = dateMax(requestedFrom, partitionFrom)
            const coverageTo = dateMin(requestedTo, partitionTo)
            if (coverageFrom >= coverageTo) {
                addLiveRange(requestedFrom, requestedTo)
                continue
            }
            const report =
                coverageFrom.valueOf() === partitionFrom.valueOf() &&
                coverageTo.valueOf() === partitionTo.valueOf()
                    ? partition.report
                    : sliceReport(partition.report, coverageFrom, coverageTo, temporalDimension)
            if (!report) {
                addLiveRange(requestedFrom, requestedTo)
                continue
            }
            addLiveRange(requestedFrom, coverageFrom)
            archived.push({
                ...report,
                meta: {
                    ...report.meta,
                    quality: { ...report.meta.quality, imported: true },
                },
            })
            addLiveRange(coverageTo, requestedTo)
        }

        const descriptors = metricMap(adapter)
        const expandedMetrics = expandMetrics(query.metrics, descriptors)
        const liveReports = await Promise.all(
            liveRanges.map((range) => {
                const liveQuery: ResolvedAnalyticsQuery = {
                    ...query,
                    dimensions: materialization.dimensions ?? query.dimensions,
                    grain: materialization.grain ?? query.grain,
                    metrics: expandedMetrics,
                    range: { from: range.from.toISOString(), to: range.to.toISOString() },
                }
                adapter.validate?.(liveQuery)
                return adapter.query(liveQuery)
            }),
        )
        return mergeReports(
            [...archived, ...liveReports],
            adapter,
            query,
            this.#now().toISOString(),
            archived.length > 0,
            materialization.grain,
        )
    }

    async maintain(adapters: readonly AnalyticsAdapter[]): Promise<AnalyticsMaintenanceResult> {
        const now = this.#now()
        let pruned = 0
        let refreshed = 0
        const warnings: AnalyticsWarning[] = []

        for (const adapter of adapters) {
            const descriptors = metricMap(adapter)
            for (const materialization of adapter.dataset.archive ?? []) {
                const baseKey = this.#baseKey(adapter.dataset.id, materialization.id)
                const indexKey = `${baseKey}:index`
                const isMonthlyPartitionKey = (key: string) =>
                    key.startsWith(`${baseKey}:`) &&
                    /^\d{4}-\d{2}$/.test(key.slice(baseKey.length + 1))
                const existingIndex = await this.#options.storage.getItem<unknown>(indexKey)
                const parsedIndex = isPartitionIndex(existingIndex) ? existingIndex : undefined
                const index = parsedIndex?.keys.every(isMonthlyPartitionKey)
                    ? parsedIndex
                    : undefined
                const discoveredKeys = (await this.#options.storage.getKeys(baseKey)).filter(
                    isMonthlyPartitionKey,
                )
                const knownKeys = new Set([
                    ...(index?.keys.filter(isMonthlyPartitionKey) ?? []),
                    ...discoveredKeys,
                ])
                const discoveredStart = sorted(discoveredKeys.map((key) => key.slice(-7)))[0]
                const providerStart = recommendedArchiveStart(adapter, now)
                const configuredStart = new Date(
                    materialization.start ??
                        index?.start ??
                        (discoveredStart
                            ? `${discoveredStart}-01T00:00:00.000Z`
                            : (providerStart?.toISOString() ?? monthStart(now).toISOString())),
                )
                if (!Number.isFinite(configuredStart.valueOf())) {
                    throw new AnalyticsError(
                        'INVALID_QUERY',
                        `Invalid archive start for materialization "${materialization.id}"`,
                    )
                }
                const retentionCutoff = this.#options.retention
                    ? new Date(resolveRange(this.#options.retention, now).from)
                    : undefined

                for (
                    let month = monthStart(configuredStart);
                    month <= monthStart(now);
                    month = nextMonth(month)
                ) {
                    const key = this.#partitionKey(adapter.dataset.id, materialization.id, month)
                    const end = dateMin(nextMonth(month), now)
                    const start = dateMax(month, configuredStart)
                    if (start >= end) continue
                    if (retentionCutoff && nextMonth(month) <= retentionCutoff) continue

                    const existing = await this.#options.storage.getItem<unknown>(key)
                    const isCurrentMonth = nextMonth(month) > now
                    const matchesIdentity =
                        isArchivePartition(existing) &&
                        existing.project === this.#name &&
                        existing.environment === this.#environment &&
                        existing.source === adapter.dataset.id &&
                        existing.materialization === materialization.id
                    const existingFrom = matchesIdentity
                        ? new Date(existing.query.range.from)
                        : undefined
                    if (
                        !isCurrentMonth &&
                        matchesIdentity &&
                        existingFrom &&
                        existingFrom >= start &&
                        existingFrom < end &&
                        existing.query.range.to === end.toISOString()
                    ) {
                        knownKeys.add(key)
                        continue
                    }

                    const query: ResolvedAnalyticsQuery = {
                        dimensions: materialization.dimensions ?? [],
                        grain: materialization.grain ?? 'day',
                        metrics: expandMetrics(materialization.metrics, descriptors),
                        range: { from: start.toISOString(), to: end.toISOString() },
                        source: adapter.dataset.id,
                        timezone: 'UTC',
                    }
                    adapter.validate?.(query)
                    const report = await adapter.query(query)
                    const partition: ArchivePartition = {
                        environment: this.#environment,
                        generatedAt: now.toISOString(),
                        materialization: materialization.id,
                        project: this.#name,
                        query,
                        report,
                        schemaVersion,
                        source: adapter.dataset.id,
                    }
                    await this.#options.storage.setItem(key, partition)
                    knownKeys.add(key)
                    refreshed += 1
                }

                if (retentionCutoff) {
                    for (const key of knownKeys) {
                        const id = key.slice(-7)
                        const partitionMonth = new Date(`${id}-01T00:00:00.000Z`)
                        if (
                            Number.isFinite(partitionMonth.valueOf()) &&
                            nextMonth(partitionMonth) <= retentionCutoff
                        ) {
                            await this.#options.storage.removeItem(key)
                            knownKeys.delete(key)
                            pruned += 1
                        } else if (
                            Number.isFinite(partitionMonth.valueOf()) &&
                            partitionMonth < retentionCutoff &&
                            retentionCutoff < nextMonth(partitionMonth)
                        ) {
                            const partition = await this.#read(
                                key,
                                adapter.dataset.id,
                                materialization.id,
                            )
                            if (!partition) continue
                            const temporalDimensions = (materialization.dimensions ?? []).filter(
                                (dimension) => {
                                    const valueType = adapter.dataset.dimensions.find(
                                        ({ id: datasetDimension }) =>
                                            datasetDimension === dimension,
                                    )?.valueType
                                    return valueType === 'date' || valueType === 'datetime'
                                },
                            )
                            const trimmed = trimPartition(
                                partition,
                                retentionCutoff,
                                temporalDimensions.length === 1 ? temporalDimensions[0] : undefined,
                            )
                            if (trimmed) {
                                if (trimmed !== partition) {
                                    await this.#options.storage.setItem(key, trimmed)
                                    pruned += 1
                                }
                            } else {
                                await this.#options.storage.removeItem(key)
                                knownKeys.delete(key)
                                pruned += 1
                                warnings.push({
                                    code: 'archive_retention_partial_dropped',
                                    message: `Dropped ${key} because its expired observations cannot be filtered safely`,
                                })
                            }
                        }
                    }
                }

                await this.#options.storage.setItem(indexKey, {
                    keys: sorted([...knownKeys]),
                    schemaVersion,
                    start: configuredStart.toISOString(),
                } satisfies PartitionIndex)
            }
        }

        return { pruned, refreshed, ...(warnings.length > 0 ? { warnings } : {}) }
    }
}
