/* eslint-disable no-await-in-loop -- repository reads and writes preserve deterministic segment order */

import { InsightError } from '../core/errors.ts'
import type {
    HistoryExtension,
    HistoryRuntime,
    HistoryRuntimeContext,
    QueryQuality,
    QueryResult,
    RuntimeSource,
    SourceRequest,
} from '../core/types.ts'
import {
    type DimensionValue,
    type Grain,
    type HistoryFidelity,
    type HistoryFidelityBand,
    type HistoryTransformation,
    type MetricData,
    type MetricDefinition,
    type MetricMeta,
    type MetricSourceDefinition,
    type MetricPoint,
    type NormalizedMetricQuery,
    normalizeTimeRange,
    type TimeRange,
} from '../metrics/index.ts'

export interface HistoryCoverage {
    id: string
    provisional?: boolean
    range: TimeRange
}

export interface HistorySegment extends HistoryCoverage {
    data: MetricData
    fidelity: HistoryFidelity
    meta: QueryResult<MetricData, MetricMeta>['meta']
    observedAt: string
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
    | { field: string; kind: 'filter'; values: readonly DimensionValue[] }
    | { fields: readonly string[]; kind: 'omit-fields' }
    | { kind: 'truncate'; limit: number }
    | { grain: Grain; kind: 'aggregate' }
    | {
          id: string
          kind: 'custom'
          transform(data: MetricData): MetricData | Promise<MetricData>
      }

export interface HistoryReductionRule {
    range?: TimeRange
    transformations: readonly HistoryReduction[]
}

export interface HistoryController {
    sync(options: {
        range: TimeRange
        sources?: readonly string[]
    }): Promise<{ fetched: number; skipped: number }>
}

export interface HistoryOptions<TSource extends string = string> {
    reductions?: Partial<Readonly<Record<TSource, readonly HistoryReductionRule[]>>>
    repository: HistoryRepository
    sources: readonly TSource[]
}

export const createHistory = <const TSource extends string>(
    options: HistoryOptions<TSource>,
): HistoryExtension<HistoryController> => ({
    attach(context) {
        return new HistoryEngine(options, context)
    },
})

class HistoryEngine implements HistoryRuntime<HistoryController> {
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
            if (!metricSource(source)?.history) {
                throw new InsightError(
                    'CAPABILITY_UNAVAILABLE',
                    `Source "${sourceId}" does not declare Metric History`,
                )
            }
        }
    }

    handles(source: RuntimeSource, input: unknown): boolean {
        if (!this.#sourceIds.has(source.id)) return false
        const definition = metricSource(source)
        if (!definition?.history || !isNormalizedMetricQuery(input)) return false
        const metrics = new Set(definition.history.metrics ?? Object.keys(definition.metrics))
        const dimensions = new Set(definition.history.dimensions ?? [])
        return (
            input.where === undefined &&
            input.metrics.every((metric) => metrics.has(metric)) &&
            input.dimensions.every((dimension) => dimensions.has(dimension))
        )
    }

    async sync(options: {
        range: TimeRange
        sources?: readonly string[]
    }): Promise<{ fetched: number; skipped: number }> {
        return this.#instrument('insight.history.sync', {}, async () => {
            const requested = normalizeTimeRange(options.range)
            const planned: { range: TimeRange; source: RuntimeSource }[] = []
            let skipped = 0
            for (const source of this.#selectedSources(options.sources)) {
                const coverage = await this.#instrument(
                    'insight.history.read',
                    { 'insight.source': source.id },
                    () =>
                        this.#options.repository.coverage({ range: requested, source: source.id }),
                )
                const gaps = uncoveredRanges(requested, coverage)
                if (gaps.length === 0) {
                    skipped += 1
                    continue
                }
                planned.push(
                    ...gaps
                        .flatMap((range) => splitForRules(this.#options, source.id, range))
                        .map((range) => ({ range, source })),
                )
            }
            const results = await this.#context.execute(
                planned.map(({ range, source }) => historyRequest(source, range)),
            )
            for (const [index, plan] of planned.entries()) {
                const result = results[index]!
                const reduced = await applyReductions(
                    requireMetricData(result.data, plan.source.id),
                    reductionsFor(this.#options, plan.source.id, plan.range),
                    plan.source,
                )
                await this.#instrument(
                    'insight.history.write',
                    { 'insight.source': plan.source.id },
                    () =>
                        this.#options.repository.write({
                            data: reduced.data,
                            fidelity: reduced.fidelity,
                            id: segmentId(plan.source.id, plan.range),
                            meta: result.meta,
                            observedAt: this.#context.now().toISOString(),
                            ...(isProvisional(result, plan.range) ? { provisional: true } : {}),
                            range: plan.range,
                            schemaVersion: 1,
                            source: plan.source.id,
                        }),
                )
            }
            return { fetched: planned.length, skipped }
        })
    }

    async query(
        source: RuntimeSource,
        input: unknown,
        live: () => Promise<QueryResult<unknown, object>>,
    ): Promise<QueryResult<unknown, object>> {
        if (!this.handles(source, input) || !isNormalizedMetricQuery(input)) return live()
        const query = input
        const definition = metricSource(source)
        if (!definition) return invalidHistory(source.id)
        const segments = validSegments(
            await this.#instrument('insight.history.read', { 'insight.source': source.id }, () =>
                this.#options.repository.read({ range: query.time, source: source.id }),
            ),
            source.id,
        )
        const coverage = segments.map(({ id, provisional, range }) => ({
            id,
            ...(provisional ? { provisional } : {}),
            range,
        }))
        const gaps = uncoveredRanges(query.time, coverage)
        const liveResults =
            gaps.length === 0
                ? []
                : await this.#context.execute(
                      gaps.map((range) => historyRequest(source, range, query)),
                  )
        const data = mergeData([
            ...segments.map(({ data: value }) => value),
            ...liveResults.map(({ data: value }) => requireMetricData(value, source.id)),
        ])
        const materialized = materialize(data, definition, query)
        const quality = mergeQuality([
            ...segments.map(({ meta }) => meta.quality),
            ...liveResults.map(({ meta }) => meta.quality),
        ])
        const fidelity: HistoryFidelityBand[] = segments.map(({ fidelity: value, range }) => ({
            ...value,
            range,
        }))
        const result: QueryResult<MetricData, MetricMeta> = {
            data: materialized,
            meta: {
                ...(fidelity.length > 0 ? { fidelity } : {}),
                ...(quality ? { quality } : {}),
                queriedAt: this.#context.now().toISOString(),
                source: source.id,
                temporal: {
                    ...(query.grain === 'auto' ? {} : { grain: query.grain }),
                    ...(query.timezone ? { bucketTimezone: query.timezone } : {}),
                },
            },
        }
        return result
    }

    #selectedSources(requested: readonly string[] | undefined): RuntimeSource[] {
        const selected = requested ? new Set(requested) : this.#sourceIds
        for (const id of selected) {
            if (!this.#sourceIds.has(id)) {
                throw new InsightError('SOURCE_NOT_FOUND', `History Source "${id}" is not enabled`)
            }
        }
        return this.#context.sources.filter(({ id }) => selected.has(id))
    }

    #instrument<T>(
        name: string,
        attributes: Readonly<Record<string, boolean | number | string>>,
        operation: () => Promise<T>,
    ): Promise<T> {
        return this.#context.instrumentation
            ? Promise.resolve(
                  this.#context.instrumentation.run(name, attributes, () => operation()),
              )
            : operation()
    }
}

const historyRequest = (
    source: RuntimeSource,
    range: TimeRange,
    query?: NormalizedMetricQuery,
): SourceRequest => {
    const definition = metricSource(source)
    if (!definition?.history) return invalidHistory(source.id)
    return {
        query: {
            dimensions: query?.dimensions ?? definition.history.dimensions ?? [],
            metrics: definition.history.metrics ?? Object.keys(definition.metrics),
            time: {
                from: range.from,
                grain: definition.history.grain,
                to: range.to,
            },
            ...(query?.timezone ? { timezone: query.timezone } : {}),
        },
        source,
    }
}

const metricSource = (source: RuntimeSource): MetricSourceDefinition | undefined => {
    const definition = source.definition
    return isMetricSourceDefinition(definition) ? definition : undefined
}

const isMetricSourceDefinition = (value: unknown): value is MetricSourceDefinition =>
    isRecord(value) &&
    value.metricSource === true &&
    isRecord(value.metrics) &&
    isRecord(value.dimensions) &&
    typeof value.normalize === 'function' &&
    typeof value.key === 'function' &&
    typeof value.execute === 'function'

const isNormalizedMetricQuery = (value: unknown): value is NormalizedMetricQuery =>
    isRecord(value) &&
    Array.isArray(value.metrics) &&
    value.metrics.every((metric) => typeof metric === 'string') &&
    Array.isArray(value.dimensions) &&
    value.dimensions.every((dimension) => typeof dimension === 'string') &&
    isRecord(value.time) &&
    typeof value.time.from === 'string' &&
    typeof value.time.to === 'string'

const requireMetricData = (value: unknown, source: string): MetricData => {
    if (!isMetricData(value)) {
        throw new InsightError('HISTORY_CORRUPT', `Invalid Metric data from "${source}"`)
    }
    return value
}

const isMetricData = (value: unknown): value is MetricData =>
    isRecord(value) &&
    isMetricValues(value.values) &&
    (value.points === undefined ||
        (Array.isArray(value.points) && value.points.every(isMetricPoint)))

const isMetricPoint = (value: unknown): value is MetricPoint =>
    isRecord(value) &&
    isMetricValues(value.values) &&
    (value.time === undefined || typeof value.time === 'string') &&
    (value.dimensions === undefined ||
        (isRecord(value.dimensions) &&
            Object.values(value.dimensions).every(
                (dimension) =>
                    dimension === null ||
                    typeof dimension === 'boolean' ||
                    typeof dimension === 'number' ||
                    typeof dimension === 'string',
            )))

const isMetricValues = (value: unknown): value is MetricData['values'] =>
    isRecord(value) &&
    Object.values(value).every(
        (metric) => metric === null || (typeof metric === 'number' && Number.isFinite(metric)),
    )

const mergeData = (values: readonly MetricData[]): MetricData => {
    const points = values.flatMap((value) => value.points ?? [])
    return {
        ...(points.length > 0 ? { points } : {}),
        values: Object.assign({}, ...values.map((value) => value.values)),
    }
}

const materialize = (
    data: MetricData,
    source: MetricSourceDefinition,
    query: NormalizedMetricQuery,
): MetricData => {
    const resolve = (metric: string, points: readonly MetricPoint[]): number | null => {
        const definition = source.metrics[metric]
        if (!definition) {
            throw new InsightError('HISTORY_CORRUPT', `Unknown stored metric "${metric}"`)
        }
        if (definition.aggregation?.kind === 'ratio') {
            return ratio(
                resolve(definition.aggregation.numerator, points),
                resolve(definition.aggregation.denominator, points),
            )
        }
        return aggregate(
            points.map((point) => point.values[metric] ?? null),
            definition,
            metric,
            source,
        )
    }
    const groups = new Map<string, MetricPoint[]>()
    for (const point of data.points ?? []) {
        const normalized: MetricPoint = {
            ...(query.dimensions.length > 0
                ? {
                      dimensions: Object.fromEntries(
                          query.dimensions.map((dimension) => [
                              dimension,
                              point.dimensions?.[dimension] ?? null,
                          ]),
                      ),
                  }
                : {}),
            ...(query.grain === 'auto' || !point.time
                ? {}
                : { time: bucketStart(point.time, query.grain) }),
            values: point.values,
        }
        const key = pointKey(normalized)
        const group = groups.get(key) ?? []
        group.push(normalized)
        groups.set(key, group)
    }
    const outputPoints = [...groups.values()]
        .map((group) => ({
            ...(group[0]?.dimensions ? { dimensions: group[0].dimensions } : {}),
            ...(group[0]?.time ? { time: group[0].time } : {}),
            values: Object.fromEntries(
                query.metrics.map((metric) => [metric, resolve(metric, group)]),
            ),
        }))
        .toSorted((left, right) => pointKey(left).localeCompare(pointKey(right)))
    const limited = query.limit ? outputPoints.slice(0, query.limit) : outputPoints
    const scalar = (metric: string): number | null => {
        const definition = source.metrics[metric]
        if (!definition) {
            throw new InsightError('HISTORY_CORRUPT', `Unknown stored metric "${metric}"`)
        }
        return definition.aggregation?.kind === 'ratio'
            ? ratio(
                  scalar(definition.aggregation.numerator),
                  scalar(definition.aggregation.denominator),
              )
            : (data.values[metric] ?? null)
    }
    return {
        ...(limited.length > 0 ? { points: limited } : {}),
        values: Object.fromEntries(
            query.metrics.map((metric) => [
                metric,
                data.points?.length ? resolve(metric, data.points) : scalar(metric),
            ]),
        ),
    }
}

const aggregate = (
    values: readonly (number | null)[],
    definition: MetricDefinition,
    metric: string,
    source: MetricSourceDefinition,
): number | null => {
    const present = values.filter((value): value is number => value !== null)
    if (definition.rollup === 'additive') {
        return present.reduce((total, value) => total + value, 0)
    }
    if (definition.aggregation?.kind === 'last') return values.at(-1) ?? null
    if (values.length <= 1) return values[0] ?? null
    const reason =
        definition.aggregation?.kind === 'percentile'
            ? 'percentile'
            : (definition.aggregation?.kind ?? definition.rollup ?? 'unspecified')
    throw new InsightError(
        'UNSAFE_ROLLUP',
        `Metric "${metric}" cannot roll up ${reason} values safely`,
        { cause: source },
    )
}

const ratio = (numerator: number | null | undefined, denominator: number | null | undefined) =>
    numerator === null || numerator === undefined || !denominator ? null : numerator / denominator

const pointKey = (point: MetricPoint): string =>
    JSON.stringify([point.time ?? null, point.dimensions ?? {}])

async function applyReductions(
    input: MetricData,
    reductions: readonly HistoryReduction[],
    source: RuntimeSource,
): Promise<{ data: MetricData; fidelity: HistoryFidelity }> {
    let data = input
    const transformations: HistoryTransformation[] = []
    for (const reduction of reductions) {
        if (reduction.kind === 'sample') {
            if (!(reduction.rate > 0 && reduction.rate <= 1)) {
                throw new InsightError('INVALID_QUERY', 'History sample rate must be in (0, 1]')
            }
            const step = Math.max(1, Math.round(1 / reduction.rate))
            data = mapPoints(data, (points) => points.filter((_, index) => index % step === 0))
            transformations.push({ kind: 'sample', rate: reduction.rate })
        } else if (reduction.kind === 'filter') {
            data = mapPoints(data, (points) =>
                points.filter((point) =>
                    reduction.values.includes(point.dimensions?.[reduction.field] ?? null),
                ),
            )
            transformations.push({ field: reduction.field, kind: 'filter' })
        } else if (reduction.kind === 'omit-fields') {
            data = mapPoints(data, (points) =>
                points.map((point) => ({
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
            )
            transformations.push({ fields: reduction.fields, kind: 'omit-fields' })
        } else if (reduction.kind === 'truncate') {
            if (!Number.isInteger(reduction.limit) || reduction.limit < 0) {
                throw new InsightError(
                    'INVALID_QUERY',
                    'History truncate limit must be non-negative',
                )
            }
            data = mapPoints(data, (points) => points.slice(0, reduction.limit))
            transformations.push({ kind: 'truncate', limit: reduction.limit })
        } else if (reduction.kind === 'aggregate') {
            const definition = metricSource(source)
            if (!definition) return invalidHistory(source.id)
            data = materialize(data, definition, {
                dimensions: allDimensions(data),
                grain: reduction.grain,
                metrics: Object.keys(data.values),
                time: storedRange(data),
                timezone: 'UTC',
            })
            transformations.push({ grain: reduction.grain, kind: 'aggregate' })
        } else {
            data = await reduction.transform(data)
            transformations.push({ id: reduction.id, kind: 'custom' })
        }
    }
    return {
        data,
        fidelity: {
            preservation: transformations.length === 0 ? 'full' : 'reduced',
            transformations,
        },
    }
}

const mapPoints = (
    data: MetricData,
    transform: (points: readonly MetricPoint[]) => readonly MetricPoint[],
): MetricData => (data.points ? { ...data, points: transform(data.points) } : data)

const allDimensions = (data: MetricData): string[] => [
    ...new Set((data.points ?? []).flatMap(({ dimensions }) => Object.keys(dimensions ?? {}))),
]

const storedRange = (data: MetricData): TimeRange => {
    const times = (data.points ?? []).flatMap(({ time }) => (time ? [time] : [])).toSorted()
    const from = times[0] ?? new Date(0).toISOString()
    const last = times.at(-1) ?? from
    return { from, to: new Date(new Date(last).valueOf() + 1).toISOString() }
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

const mergeQuality = (values: readonly (QueryQuality | undefined)[]): QueryQuality | undefined => {
    const present = values.filter((value): value is QueryQuality => value !== undefined)
    if (present.length === 0) return undefined
    const warnings = present.flatMap(({ warnings: items }) => items ?? [])
    const sampleRates = present.flatMap(({ sampleRate }) =>
        sampleRate === undefined ? [] : [sampleRate],
    )
    return {
        ...(present.some(({ approximate }) => approximate) ? { approximate: true } : {}),
        ...(present.some(({ partial }) => partial) ? { partial: true } : {}),
        ...(present.some(({ sampled }) => sampled) ? { sampled: true } : {}),
        ...(sampleRates.length > 0 ? { sampleRate: Math.min(...sampleRates) } : {}),
        ...(present.some(({ thresholded }) => thresholded) ? { thresholded: true } : {}),
        ...(warnings.length > 0 ? { warnings } : {}),
    }
}

const isProvisional = (result: QueryResult<unknown, object>, range: TimeRange): boolean => {
    const meta = result.meta as QueryResult<unknown>['meta'] & {
        freshness?: { completeThrough?: string; incompleteFrom?: string }
    }
    const incomplete = meta.freshness?.incompleteFrom
    return Boolean(
        meta.quality?.partial ||
        (incomplete && incomplete < range.to && meta.freshness?.completeThrough !== range.to),
    )
}

const validSegments = (segments: readonly HistorySegment[], source: string): HistorySegment[] =>
    segments.map((segment) => {
        if (
            segment.schemaVersion !== 1 ||
            segment.source !== source ||
            !segment.fidelity ||
            !isRecord(segment.data) ||
            !isRecord(segment.meta)
        ) {
            throw new InsightError('HISTORY_CORRUPT', `Invalid History segment for "${source}"`)
        }
        return segment
    })

const segmentId = (source: string, range: TimeRange): string =>
    `${source}:${range.from}:${range.to}`

const bucketStart = (value: string, grain: Grain): string => {
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

const intersection = (left: TimeRange, right: TimeRange): TimeRange | undefined => {
    const from = left.from > right.from ? left.from : right.from
    const to = left.to < right.to ? left.to : right.to
    return from < to ? { from, to } : undefined
}

const isRecord = (value: unknown): value is Record<string, unknown> =>
    typeof value === 'object' && value !== null && !Array.isArray(value)

const invalidHistory = (source: string): never => {
    throw new InsightError('HISTORY_CORRUPT', `Invalid Metric History Source "${source}"`)
}

export type {
    HistoryFidelity,
    HistoryFidelityBand,
    HistoryTransformation,
} from '../metrics/index.ts'
