/* eslint-disable no-await-in-loop -- History planning, transformations, and repository writes are intentionally ordered */

import { InsightError } from '../core/errors.ts'
import { normalizeTimeRange } from '../core/query.ts'
import type {
    FilterValue,
    Grain,
    HistoryExtension,
    HistoryFidelity,
    HistoryRuntime,
    HistoryRuntimeContext,
    HistoryTransformation,
    MetricDefinition,
    MetricInput,
    Report,
    ReportOperation,
    ReportQuality,
    RuntimeReportSource,
    SeriesPoint,
    SeriesReport,
    TimeRange,
} from '../core/types.ts'

export interface HistoryCoverage {
    id: string
    provisional?: boolean
    range: TimeRange
}

export interface HistorySegment extends HistoryCoverage {
    fidelity: HistoryFidelity
    observedAt: string
    report: SeriesReport
    schemaVersion: 1
    source: string
}

export interface HistoryRepository {
    coverage(query: { range: TimeRange; source: string }): Promise<readonly HistoryCoverage[]>
    read(query: { range: TimeRange; source: string }): Promise<readonly HistorySegment[]>
    write(segment: HistorySegment): Promise<void>
}

export type HistoryReduction =
    | { kind: 'sample'; rate: number }
    | { field: string; kind: 'filter'; values: readonly FilterValue[] }
    | { fields: readonly string[]; kind: 'omit-fields' }
    | { kind: 'truncate'; limit: number }
    | { grain: Grain; kind: 'aggregate' }
    | {
          id: string
          kind: 'custom'
          transform(report: SeriesReport): Promise<SeriesReport> | SeriesReport
      }

export interface HistoryReductionRule {
    range?: TimeRange
    transformations: readonly HistoryReduction[]
}

export interface HistoryOptions<TSource extends string = string> {
    reductions?: Partial<Readonly<Record<TSource, readonly HistoryReductionRule[]>>>
    repository: HistoryRepository
    sources: readonly TSource[]
}

export const createHistory = <const TSource extends string>(
    options: HistoryOptions<TSource>,
): HistoryExtension => {
    return {
        attach(context) {
            return new HistoryEngine(options, context)
        },
    }
}

class HistoryEngine implements HistoryRuntime {
    readonly #context: HistoryRuntimeContext
    readonly #options: HistoryOptions
    readonly #sourceIds: Set<string>

    constructor(options: HistoryOptions, context: HistoryRuntimeContext) {
        this.#options = options
        this.#context = context
        this.#sourceIds = new Set(options.sources)
        for (const sourceId of this.#sourceIds) {
            const source = context.sources.find(({ id }) => id === sourceId)
            if (!source) {
                throw new InsightError('SOURCE_NOT_FOUND', `Unknown History Source: ${sourceId}`)
            }
            if (!source.definition.history) {
                throw new InsightError(
                    'CAPABILITY_UNAVAILABLE',
                    `Report Source "${sourceId}" does not declare History`,
                )
            }
            if (
                source.definition.history.mode === 'range' &&
                typeof source.definition.series !== 'function'
            ) {
                throw new InsightError(
                    'UNSUPPORTED_OPERATION',
                    `Range History Source "${sourceId}" must implement series()`,
                )
            }
        }
    }

    async capture(options: { sources?: readonly string[] } = {}): Promise<{ captured: number }> {
        let captured = 0
        for (const source of this.#selectedSources(options.sources, 'snapshot')) {
            const metrics =
                source.definition.history?.metrics ?? Object.keys(source.definition.metrics)
            const report = await this.#context.invoke(source, 'snapshot', { metrics })
            if (report.kind !== 'scalar') return invalidHistoryReport(source.id, 'scalar')
            const observedAt = report.meta.queriedAt
            const range = {
                from: observedAt,
                to: new Date(new Date(observedAt).valueOf() + 1).toISOString(),
            }
            const series: SeriesReport = {
                kind: 'series',
                meta: { ...report.meta, temporal: {} },
                points: [{ time: observedAt, values: report.values }],
            }
            const reduced = await applyReductions(
                series,
                reductionsFor(this.#options, source.id, range),
                source,
            )
            await this.#options.repository.write({
                fidelity: reduced.fidelity,
                id: segmentId(source.id, range),
                observedAt,
                range,
                report: reduced.report,
                schemaVersion: 1,
                source: source.id,
            })
            captured += 1
        }
        return { captured }
    }

    async sync(options: {
        range: TimeRange
        sources?: readonly string[]
    }): Promise<{ fetched: number; skipped: number }> {
        const requested = normalizeTimeRange(options.range)
        let fetched = 0
        let skipped = 0
        for (const source of this.#selectedSources(options.sources, 'range')) {
            const coverage = await this.#options.repository.coverage({
                range: requested,
                source: source.id,
            })
            const gaps = uncoveredRanges(requested, coverage)
            if (gaps.length === 0) {
                skipped += 1
                continue
            }
            for (const gap of gaps.flatMap((range) =>
                splitForRules(this.#options, source.id, range),
            )) {
                const report = await this.#context.invoke(source, 'series', {
                    grain:
                        source.definition.history?.mode === 'range'
                            ? source.definition.history.grain
                            : 'day',
                    metrics:
                        source.definition.history?.metrics ??
                        Object.keys(source.definition.metrics),
                    range: gap,
                })
                if (report.kind !== 'series') return invalidHistoryReport(source.id, 'series')
                const reduced = await applyReductions(
                    report,
                    reductionsFor(this.#options, source.id, gap),
                    source,
                )
                await this.#options.repository.write({
                    fidelity: reduced.fidelity,
                    id: segmentId(source.id, gap),
                    observedAt: this.#context.now().toISOString(),
                    ...(isProvisional(report, gap) ? { provisional: true } : {}),
                    range: gap,
                    report: reduced.report,
                    schemaVersion: 1,
                    source: source.id,
                })
                fetched += 1
            }
        }
        return { fetched, skipped }
    }

    async query(
        source: RuntimeReportSource,
        operation: ReportOperation,
        input: unknown,
        live: () => Promise<Report>,
    ): Promise<Report> {
        if (!this.#sourceIds.has(source.id) || !source.definition.history) return live()
        if (operation === 'snapshot') return live()
        const query = requireQuery(input)
        const historyMetrics = new Set(
            source.definition.history.metrics ?? Object.keys(source.definition.metrics),
        )
        if (stringArray(query.metrics).some((metric) => !historyMetrics.has(metric))) return live()
        if (source.definition.history.mode === 'snapshot') {
            if (operation !== 'series') return live()
            return this.#snapshotSeries(source, query)
        }
        if (operation === 'breakdown') {
            const dimensions = stringArray(query.dimensions)
            const safe = new Set(source.definition.history.breakdowns ?? [])
            if (dimensions.some((dimension) => !safe.has(dimension))) return live()
        }
        return this.#rangeReport(source, operation, query)
    }

    async #rangeReport(
        source: RuntimeReportSource,
        operation: ReportOperation,
        query: Record<string, unknown>,
    ): Promise<Report> {
        const history = source.definition.history
        if (!history || history.mode !== 'range') return invalidHistoryReport(source.id, 'range')
        const range = queryRange(query)
        const metrics = stringArray(query.metrics)
        const segments = validSegments(
            await this.#options.repository.read({ range, source: source.id }),
            source.id,
        )
        const coverage = segments.map(({ id, provisional, range: covered }) => ({
            id,
            ...(provisional ? { provisional } : {}),
            range: covered,
        }))
        const liveReports: SeriesReport[] = []
        for (const gap of uncoveredRanges(range, coverage)) {
            const report = await this.#context.invoke(source, 'series', {
                grain: history.grain,
                metrics: history.metrics ?? Object.keys(source.definition.metrics),
                range: gap,
                ...(query.filters ? { filters: query.filters } : {}),
                ...(query.timezone ? { timezone: query.timezone } : {}),
            })
            if (report.kind !== 'series') return invalidHistoryReport(source.id, 'series')
            liveReports.push(report)
        }
        const points = sortedPoints([
            ...segments.flatMap(({ report }) => report.points),
            ...liveReports.flatMap(({ points: livePoints }) => livePoints),
        ]).filter(({ time }) => contains(range, time))
        const quality = mergeQuality([
            ...segments.map(({ report }) => report.meta.quality),
            ...liveReports.map(({ meta }) => meta.quality),
        ])
        const fidelity = segments.map(({ fidelity: value, range: segmentRange }) => ({
            ...value,
            range: intersection(range, segmentRange) ?? segmentRange,
        }))
        const queryGrain = historyGrain(query.grain)
        const queryTimezone = typeof query.timezone === 'string' ? query.timezone : undefined
        const meta = {
            ...(fidelity.length > 0 ? { fidelity } : {}),
            quality,
            queriedAt: this.#context.now().toISOString(),
            source: source.id,
            temporal: {
                ...(queryGrain ? { grain: queryGrain } : {}),
                ...(queryTimezone ? { bucketTimezone: queryTimezone } : {}),
            },
        }
        if (operation === 'series') {
            const grain = queryGrain ?? history.grain
            const rolled = rollupSeries(points, grain, source, metrics)
            return {
                kind: 'series',
                meta: { ...meta, temporal: { ...meta.temporal, grain } },
                points: rolled.map((point) => ({
                    ...point,
                    values: selectMetrics(point.values, metrics),
                })),
            }
        }
        if (operation === 'summary') {
            return {
                kind: 'scalar',
                meta,
                values: selectMetrics(aggregateValues(points, source, metrics), metrics),
            }
        }
        const dimensions = stringArray(query.dimensions)
        const groups = new Map<
            string,
            { dimensions: Record<string, FilterValue>; points: SeriesPoint[] }
        >()
        for (const point of points) {
            const values = Object.fromEntries(
                dimensions.map((dimension) => [dimension, point.dimensions?.[dimension] ?? null]),
            )
            const key = JSON.stringify(values)
            const group = groups.get(key) ?? { dimensions: values, points: [] }
            group.points.push(point)
            groups.set(key, group)
        }
        const rows = [...groups.values()].map(({ dimensions: rowDimensions, points: group }) => ({
            dimensions: rowDimensions,
            metrics: selectMetrics(aggregateValues(group, source, metrics), metrics),
        }))
        const limit = typeof query.limit === 'number' ? query.limit : undefined
        return { kind: 'table', meta, rows: limit ? rows.slice(0, limit) : rows }
    }

    async #snapshotSeries(
        source: RuntimeReportSource,
        query: Record<string, unknown>,
    ): Promise<SeriesReport> {
        const range = queryRange(query)
        const metrics = stringArray(query.metrics)
        const segments = validSegments(
            await this.#options.repository.read({ range, source: source.id }),
            source.id,
        )
        const points = sortedPoints(segments.flatMap(({ report }) => report.points)).filter(
            ({ time }) => contains(range, time),
        )
        const grain = historyGrain(query.grain) ?? 'day'
        return {
            kind: 'series',
            meta: {
                fidelity: segments.map(({ fidelity, range: segmentRange }) => ({
                    ...fidelity,
                    range: segmentRange,
                })),
                quality: mergeQuality(segments.map(({ report }) => report.meta.quality)),
                queriedAt: this.#context.now().toISOString(),
                source: source.id,
                temporal: { grain },
            },
            points: rollupSeries(points, grain, source, metrics).map((point) => ({
                ...point,
                values: selectMetrics(point.values, metrics),
            })),
        }
    }

    #selectedSources(requested: readonly string[] | undefined, mode: 'range' | 'snapshot') {
        const selected = requested ? new Set(requested) : this.#sourceIds
        for (const id of selected) {
            if (!this.#sourceIds.has(id)) {
                throw new InsightError('SOURCE_NOT_FOUND', `History Source "${id}" is not enabled`)
            }
        }
        return this.#context.sources.filter(
            ({ definition, id }) => selected.has(id) && definition.history?.mode === mode,
        )
    }
}

function uncoveredRanges(requested: TimeRange, coverage: readonly HistoryCoverage[]): TimeRange[] {
    const complete = coverage
        .filter(({ provisional }) => !provisional)
        .map(({ range }) => intersection(requested, normalizeTimeRange(range)))
        .filter((range): range is TimeRange => range !== undefined)
        .toSorted((left, right) => left.from.localeCompare(right.from))
    const gaps: TimeRange[] = []
    let cursor = requested.from
    for (const range of complete) {
        if (range.to <= cursor) continue
        if (range.from > cursor) gaps.push({ from: cursor, to: range.from })
        cursor = range.to > cursor ? range.to : cursor
    }
    if (cursor < requested.to) gaps.push({ from: cursor, to: requested.to })
    return gaps
}

function splitForRules(options: HistoryOptions, source: string, range: TimeRange): TimeRange[] {
    const boundaries = (options.reductions?.[source] ?? [])
        .flatMap((rule) => (rule.range ? [rule.range.from, rule.range.to] : []))
        .filter((value) => value > range.from && value < range.to)
    const points = [range.from, ...new Set(boundaries), range.to].toSorted()
    return points.slice(0, -1).map((from, index) => ({ from, to: points[index + 1]! }))
}

function reductionsFor(
    options: HistoryOptions,
    source: string,
    range: TimeRange,
): readonly HistoryReduction[] {
    return (options.reductions?.[source] ?? []).flatMap((rule) =>
        !rule.range || intersection(rule.range, range) ? rule.transformations : [],
    )
}

async function applyReductions(
    input: SeriesReport,
    reductions: readonly HistoryReduction[],
    source: RuntimeReportSource,
): Promise<{ fidelity: HistoryFidelity; report: SeriesReport }> {
    let report = input
    const transformations: HistoryTransformation[] = []
    for (const reduction of reductions) {
        if (reduction.kind === 'sample') {
            if (!(reduction.rate > 0 && reduction.rate <= 1)) {
                throw new InsightError('INVALID_QUERY', 'History sample rate must be in (0, 1]')
            }
            const step = Math.max(1, Math.round(1 / reduction.rate))
            report = { ...report, points: report.points.filter((_, index) => index % step === 0) }
            transformations.push({ kind: 'sample', rate: reduction.rate })
        } else if (reduction.kind === 'filter') {
            report = {
                ...report,
                points: report.points.filter((point) =>
                    reduction.values.includes(point.dimensions?.[reduction.field] ?? null),
                ),
            }
            transformations.push({ field: reduction.field, kind: 'filter' })
        } else if (reduction.kind === 'omit-fields') {
            report = {
                ...report,
                points: report.points.map((point) => ({
                    ...point,
                    ...(point.dimensions
                        ? {
                              dimensions: Object.fromEntries(
                                  Object.entries(point.dimensions).filter(
                                      ([field]) => !reduction.fields.includes(field),
                                  ),
                              ),
                          }
                        : {}),
                })),
            }
            transformations.push({ fields: reduction.fields, kind: 'omit-fields' })
        } else if (reduction.kind === 'truncate') {
            if (!Number.isInteger(reduction.limit) || reduction.limit < 0) {
                throw new InsightError(
                    'INVALID_QUERY',
                    'History truncate limit must be non-negative',
                )
            }
            report = { ...report, points: report.points.slice(0, reduction.limit) }
            transformations.push({ kind: 'truncate', limit: reduction.limit })
        } else if (reduction.kind === 'aggregate') {
            report = {
                ...report,
                meta: {
                    ...report.meta,
                    temporal: { ...report.meta.temporal, grain: reduction.grain },
                },
                points: rollupSeries(report.points, reduction.grain, source),
            }
            transformations.push({ grain: reduction.grain, kind: 'aggregate' })
        } else {
            report = await reduction.transform(report)
            transformations.push({ id: reduction.id, kind: 'custom' })
        }
    }
    return {
        fidelity: {
            preservation: transformations.length === 0 ? 'full' : 'reduced',
            transformations,
        },
        report,
    }
}

function rollupSeries(
    points: readonly SeriesPoint[],
    grain: Grain,
    source: RuntimeReportSource,
    metrics?: readonly string[],
): SeriesPoint[] {
    const groups = new Map<string, { points: SeriesPoint[]; time: string }>()
    for (const point of points) {
        const time = bucketStart(point.time, grain)
        const key = JSON.stringify([time, point.dimensions ?? {}])
        const group = groups.get(key) ?? { points: [], time }
        group.points.push(point)
        groups.set(key, group)
    }
    return [...groups.values()].map(({ points: group, time }) => {
        return {
            ...(group[0]?.dimensions ? { dimensions: group[0].dimensions } : {}),
            time,
            values: aggregateValues(group, source, metrics),
        }
    })
}

function aggregateValues(
    points: readonly SeriesPoint[],
    source: RuntimeReportSource,
    requested: readonly string[] = Object.keys(source.definition.metrics),
): Readonly<Record<string, number | null>> {
    const definitions = Object.fromEntries(
        Object.entries(source.definition.metrics).map(([metric, input]) => [
            metric,
            normalizeMetric(input),
        ]),
    )
    const selected = new Set(requested)
    for (const metric of requested) {
        const definition = definitions[metric]
        if (definition?.derive) {
            selected.add(definition.derive.numerator)
            selected.add(definition.derive.denominator)
        }
    }
    const values: Record<string, number | null> = {}
    for (const [metric, definition] of Object.entries(definitions)) {
        if (!selected.has(metric)) continue
        if (definition.rollup === 'derived') continue
        const metricValues = points.map(({ values: pointValues }) => pointValues[metric] ?? null)
        const present = metricValues.filter((value): value is number => value !== null)
        if (definition.rollup === 'additive') {
            values[metric] = present.reduce((total, value) => total + value, 0)
        } else if (definition.aggregation === 'last') {
            values[metric] = metricValues.at(-1) ?? null
        } else if (points.length <= 1) {
            values[metric] = metricValues[0] ?? null
        } else {
            throw new InsightError(
                'UNSAFE_ROLLUP',
                `Metric "${metric}" from "${source.id}" cannot be rolled up safely`,
            )
        }
    }
    for (const [metric, definition] of Object.entries(definitions)) {
        if (!selected.has(metric)) continue
        if (definition.rollup !== 'derived' || !definition.derive) continue
        const numerator = values[definition.derive.numerator]
        const denominator = values[definition.derive.denominator]
        values[metric] =
            numerator === null || numerator === undefined || !denominator
                ? null
                : numerator / denominator
    }
    return values
}

function normalizeMetric(input: MetricInput): MetricDefinition {
    return typeof input === 'string' ? { valueType: input } : input
}

function mergeQuality(values: readonly ReportQuality[]): ReportQuality {
    const warnings = values.flatMap(({ warnings: items }) => items ?? [])
    const sampleRates = values.flatMap(({ sampleRate }) =>
        sampleRate === undefined ? [] : [sampleRate],
    )
    return {
        ...(values.some(({ approximate }) => approximate) ? { approximate: true } : {}),
        ...(values.some(({ partial }) => partial) ? { partial: true } : {}),
        ...(values.some(({ sampled }) => sampled) ? { sampled: true } : {}),
        ...(sampleRates.length > 0 ? { sampleRate: Math.min(...sampleRates) } : {}),
        ...(values.some(({ thresholded }) => thresholded) ? { thresholded: true } : {}),
        ...(warnings.length > 0 ? { warnings } : {}),
    }
}

function isProvisional(report: SeriesReport, range: TimeRange): boolean {
    const incomplete = report.meta.freshness?.incompleteFrom
    return Boolean(
        report.meta.quality.partial ||
        (incomplete &&
            incomplete < range.to &&
            report.meta.freshness?.completeThrough !== range.to),
    )
}

function validSegments(segments: readonly HistorySegment[], source: string): HistorySegment[] {
    return segments.map((segment) => {
        if (
            segment.schemaVersion !== 1 ||
            segment.source !== source ||
            !segment.fidelity ||
            segment.report.kind !== 'series'
        ) {
            throw new InsightError('HISTORY_CORRUPT', `Invalid History segment for "${source}"`)
        }
        return segment
    })
}

function segmentId(source: string, range: TimeRange): string {
    return `${source}:${range.from}:${range.to}`
}

function bucketStart(value: string, grain: Grain): string {
    const date = new Date(value)
    if (!Number.isFinite(date.valueOf())) {
        throw new InsightError('HISTORY_CORRUPT', `Invalid History timestamp: ${value}`)
    }
    if (grain === 'year') date.setUTCMonth(0, 1)
    if (grain === 'year' || grain === 'month') date.setUTCDate(1)
    if (grain === 'week') {
        const weekday = date.getUTCDay() || 7
        date.setUTCDate(date.getUTCDate() - weekday + 1)
    }
    if (['year', 'month', 'week', 'day'].includes(grain)) date.setUTCHours(0)
    if (grain !== 'minute') date.setUTCMinutes(0)
    date.setUTCSeconds(0, 0)
    return date.toISOString()
}

function sortedPoints(points: readonly SeriesPoint[]): SeriesPoint[] {
    const unique = new Map<string, SeriesPoint>()
    for (const point of points)
        unique.set(JSON.stringify([point.time, point.dimensions ?? {}]), point)
    return [...unique.values()].toSorted((left, right) => left.time.localeCompare(right.time))
}

function selectMetrics(
    values: Readonly<Record<string, number | null>>,
    metrics: readonly string[],
): Readonly<Record<string, number | null>> {
    return Object.fromEntries(metrics.map((metric) => [metric, values[metric] ?? null]))
}

function intersection(left: TimeRange, right: TimeRange): TimeRange | undefined {
    const from = left.from > right.from ? left.from : right.from
    const to = left.to < right.to ? left.to : right.to
    return from < to ? { from, to } : undefined
}

function contains(range: TimeRange, value: string): boolean {
    return value >= range.from && value < range.to
}

const historyGrain = (value: unknown): Grain | undefined =>
    value === 'minute' ||
    value === 'hour' ||
    value === 'day' ||
    value === 'week' ||
    value === 'month' ||
    value === 'year'
        ? value
        : undefined

function queryRange(query: Record<string, unknown>): TimeRange {
    if (
        !isRecord(query.range) ||
        typeof query.range.from !== 'string' ||
        typeof query.range.to !== 'string'
    ) {
        throw new InsightError('INVALID_QUERY', 'History query requires an absolute range')
    }
    return normalizeTimeRange({ from: query.range.from, to: query.range.to })
}

function requireQuery(value: unknown): Record<string, unknown> {
    if (!isRecord(value)) throw new InsightError('INVALID_QUERY', 'Report query must be an object')
    return value
}

function stringArray(value: unknown): string[] {
    if (!Array.isArray(value) || value.some((item) => typeof item !== 'string')) {
        throw new InsightError('INVALID_QUERY', 'Expected a string array')
    }
    return value
}

function isRecord(value: unknown): value is Record<string, unknown> {
    return typeof value === 'object' && value !== null && !Array.isArray(value)
}

function invalidHistoryReport(source: string, expected: string): never {
    throw new InsightError(
        'HISTORY_CORRUPT',
        `History Source "${source}" did not return a ${expected} report`,
    )
}

export type { HistoryFidelity, HistoryFidelityBand, HistoryTransformation } from '../core/types.ts'
