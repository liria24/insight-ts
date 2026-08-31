/* eslint-disable no-await-in-loop -- pagination and replacement order are intentional */

import { InsightError } from '../core/errors.ts'
import { normalizeTimeRange, type TimeRange } from '../core/time.ts'
import type {
    AdapterExecutionResult,
    HistoryExtension,
    HistoryFidelity,
    HistoryFidelityBand,
    HistoryRuntime,
    HistoryRuntimeContext,
    HistoryTransformation,
    QueryQuality,
    RuntimeSource,
} from '../core/types.ts'

export interface HistoryTarget {
    adapter: string
    capability: string
    scope: string
}

export interface HistoryCoverage {
    id: string
    provisional?: boolean
    range: TimeRange
}

export interface HistorySegment extends HistoryCoverage, HistoryTarget {
    data?: unknown
    empty?: boolean
    fidelity: HistoryFidelity
    meta?: object
    observedAt: string
    quality?: QueryQuality
    schemaVersion: 2
    sortKey: string
}

export interface HistoryReadQuery extends HistoryTarget {
    cursor?: string
    limit: number
    range: TimeRange
}

export interface HistoryReadResult {
    next?: string
    segments: readonly HistorySegment[]
}

export interface HistoryRepository {
    coverage(query: HistoryTarget & { range: TimeRange }): Promise<readonly HistoryCoverage[]>
    delete(query: HistoryTarget & { range: TimeRange }): Promise<void>
    read(query: HistoryReadQuery): Promise<HistoryReadResult>
    replace(
        query: HistoryTarget & { range: TimeRange },
        segments: readonly HistorySegment[],
    ): Promise<void>
}

export interface HistoryReductionContext extends HistoryTarget {
    range: TimeRange
}

export type HistoryReduction =
    | { kind: 'sample'; rate: number }
    | {
          id: string
          kind: 'filter'
          test(item: unknown, context: HistoryReductionContext): boolean
      }
    | { kind: 'truncate'; limit: number }
    | {
          id: string
          kind: 'custom'
          transform(
              items: readonly unknown[],
              context: HistoryReductionContext,
          ): Promise<readonly unknown[]> | readonly unknown[]
      }

export interface HistoryPolicy {
    capability?: string
    range?: TimeRange
    scope?: string
    transformations: readonly HistoryReduction[]
}

export interface HistorySelection {
    capabilities?: readonly string[]
    scopes?: readonly string[]
}

export interface HistoryController {
    compact(options: { range: TimeRange } & HistorySelection): Promise<{ compacted: number }>
    expire(options?: { before?: string } & HistorySelection): Promise<{ deleted: number }>
    sync(
        options: { range: TimeRange } & HistorySelection,
    ): Promise<{ fetched: number; skipped: number }>
}

export interface HistoryOptions extends HistorySelection {
    maxPages?: number
    policies?: readonly HistoryPolicy[]
    readSize?: number
    repository: HistoryRepository
    retention?: { maxAgeMs: number }
}

export const createHistory = (options: HistoryOptions): HistoryExtension<HistoryController> => ({
    attach: (context) => new HistoryEngine(options, context),
})

class HistoryEngine implements HistoryRuntime<HistoryController> {
    readonly #context: HistoryRuntimeContext
    readonly #maxPages: number
    readonly #options: HistoryOptions
    readonly #readSize: number
    readonly #sources: readonly RuntimeSource[]

    constructor(options: HistoryOptions, context: HistoryRuntimeContext) {
        this.#options = options
        this.#context = context
        this.#maxPages = positiveInteger(options.maxPages ?? 100, 'History maxPages')
        this.#readSize = positiveInteger(options.readSize ?? 1000, 'History readSize')
        this.#sources = context.sources.filter(
            (source) => source.definition.materialize && this.#enabled(source),
        )
        this.#validateSelections(options)
        if (options.retention && !(options.retention.maxAgeMs > 0)) {
            throw new TypeError('History retention maxAgeMs must be positive')
        }
    }

    handles(source: RuntimeSource, query: unknown): boolean {
        if (!this.#sources.includes(source)) return false
        return source.definition.materialize?.range(query) !== undefined
    }

    async sync(
        options: { range: TimeRange } & HistorySelection,
    ): Promise<{ fetched: number; skipped: number }> {
        const range = normalizeTimeRange(options.range)
        return this.#instrument('insight.history.sync', {}, async () => {
            let fetched = 0
            let skipped = 0
            for (const source of this.#select(options)) {
                const target = historyTarget(source)
                const coverage = await this.#coverage(target, range)
                const gaps = uncoveredRanges(range, coverage)
                if (gaps.length === 0) {
                    skipped += 1
                    continue
                }
                for (const gap of gaps.flatMap((item) => this.#split(target, item))) {
                    await this.#capture(source, gap)
                    fetched += 1
                }
            }
            return { fetched, skipped }
        })
    }

    async query(
        source: RuntimeSource,
        input: unknown,
        live: () => Promise<AdapterExecutionResult<unknown, object>>,
    ): Promise<AdapterExecutionResult<unknown, object>> {
        const materializer = source.definition.materialize
        const range = materializer?.range(input)
        if (!materializer || !range || !this.#sources.includes(source)) return live()
        const normalized = normalizeTimeRange(range)
        const target = historyTarget(source)
        const coverage = await this.#coverage(target, normalized)
        for (const gap of uncoveredRanges(normalized, coverage)) {
            for (const part of this.#split(target, gap)) await this.#capture(source, part)
        }

        const cursor = decodeCursor(materializer.cursor?.(input), target)
        const limit = materializer.limit?.(input) ?? this.#readSize
        const page =
            materializer.read === 'all'
                ? { segments: await this.#readAll(target, normalized) }
                : await this.#read(target, normalized, limit, cursor)
        const segments = validSegments(page.segments, target)
        const items = segments.flatMap((segment) =>
            segment.empty || segment.data === undefined ? [] : [segment.data],
        )
        const materialized = materializer.materialize(input, items)
        const fidelity = fidelityBands(segments, normalized)
        const remaining = uncoveredRanges(normalized, await this.#coverage(target, normalized)).map(
            (missing) => ({
                preservation: 'not-preserved' as const,
                range: missing,
                transformations: [],
            }),
        )
        const quality = mergeQuality([
            ...segments.map(({ quality: value }) => value),
            materialized.quality,
            ...(remaining.length > 0 ? [{ partial: true }] : []),
        ])
        return {
            ...materialized,
            meta: {
                ...materialized.meta,
                fidelity: [...fidelity, ...remaining],
            },
            ...(page.next ? { nativeCursor: encodeCursor(page.next, target) } : {}),
            ...(quality ? { quality } : {}),
        }
    }

    async compact(
        options: { range: TimeRange } & HistorySelection,
    ): Promise<{ compacted: number }> {
        const range = normalizeTimeRange(options.range)
        let compacted = 0
        for (const source of this.#select(options)) {
            const target = historyTarget(source)
            const segments = await this.#readAll(target, range)
            if (segments.length === 0) continue
            await this.#replace(target, range, dedupeSegments(segments))
            compacted += 1
        }
        return { compacted }
    }

    async expire(
        options: { before?: string } & HistorySelection = {},
    ): Promise<{ deleted: number }> {
        const before = options.before
            ? normalizeTimeRange({ from: epoch, to: options.before }).to
            : this.#retentionBoundary()
        const range = { from: epoch, to: before }
        let deleted = 0
        for (const source of this.#select(options)) {
            await this.#options.repository.delete({ ...historyTarget(source), range })
            deleted += 1
        }
        return { deleted }
    }

    async #capture(source: RuntimeSource, range: TimeRange): Promise<void> {
        const materializer = source.definition.materialize!
        const target = historyTarget(source)
        let query = materializer.capture(range)
        const items = new Map<string, unknown>()
        let quality: QueryQuality | undefined
        let meta: object | undefined
        let page = 0
        let previousCursor: string | undefined
        while (true) {
            if (page++ >= this.#maxPages) {
                throw new InsightError(
                    'UNSUPPORTED_OPERATION',
                    `History capture exceeded ${this.#maxPages} pages for "${source.id}"`,
                )
            }
            const [result] = await this.#context.execute([{ query, source }])
            if (!result) throw new InsightError('HISTORY_CORRUPT', 'Missing History result')
            for (const [index, item] of materializer.items(result.data).entries()) {
                items.set(materializer.itemId(item, index), item)
            }
            quality = mergeQuality([quality, result.quality])
            meta = result.meta ?? meta
            if (!result.nativeCursor) break
            if (!materializer.continue || result.nativeCursor === previousCursor) {
                throw new InsightError(
                    'HISTORY_CORRUPT',
                    'History adapter returned an invalid cursor',
                )
            }
            previousCursor = result.nativeCursor
            query = materializer.continue(query, result.nativeCursor)
        }
        const sorted = [...items.values()].toSorted((left, right) =>
            materializer.sortKey(right).localeCompare(materializer.sortKey(left)),
        )
        const reduced = await applyReductions(
            sorted,
            this.#reductions(target, range),
            { ...target, range },
            (item, index) => materializer.itemId(item, index),
        )
        const observedAt = this.#context.now().toISOString()
        const provisional = isProvisional(quality, meta, range)
        const segments = reduced.items.map((data, index) => {
            const id = materializer.itemId(data, index)
            return {
                ...target,
                data,
                fidelity: reduced.fidelity,
                id: segmentId(target, range, id),
                ...(meta ? { meta } : {}),
                observedAt,
                ...(provisional ? { provisional: true } : {}),
                ...(quality ? { quality } : {}),
                range,
                schemaVersion: 2 as const,
                sortKey: materializer.sortKey(data),
            }
        })
        await this.#replace(
            target,
            range,
            segments.length > 0
                ? segments
                : [emptySegment(target, range, observedAt, reduced.fidelity, quality, provisional)],
        )
    }

    #coverage(target: HistoryTarget, range: TimeRange) {
        return this.#instrument('insight.history.read', historyAttributes(target), () =>
            this.#options.repository.coverage({ ...target, range }),
        )
    }

    #enabled(source: RuntimeSource): boolean {
        return (
            (!this.#options.scopes || this.#options.scopes.includes(source.scope)) &&
            (!this.#options.capabilities ||
                this.#options.capabilities.includes(source.definition.contract.name))
        )
    }

    #instrument<T>(
        name: string,
        attributes: Readonly<Record<string, boolean | number | string>>,
        operation: () => Promise<T>,
    ): Promise<T> {
        return this.#context.instrumentation
            ? Promise.resolve(this.#context.instrumentation.run(name, attributes, operation))
            : operation()
    }

    #read(target: HistoryTarget, range: TimeRange, limit: number, cursor?: string) {
        return this.#instrument('insight.history.read', historyAttributes(target), async () => {
            const result = await this.#options.repository.read({
                ...target,
                ...(cursor ? { cursor } : {}),
                limit: positiveInteger(limit, 'History read limit'),
                range,
            })
            if (!result || !Array.isArray(result.segments)) {
                throw new InsightError(
                    'HISTORY_CORRUPT',
                    'History repository returned an invalid page',
                )
            }
            return result
        })
    }

    async #readAll(target: HistoryTarget, range: TimeRange): Promise<HistorySegment[]> {
        const segments: HistorySegment[] = []
        let cursor: string | undefined
        for (let page = 0; page < this.#maxPages; page += 1) {
            const result = await this.#read(target, range, this.#readSize, cursor)
            segments.push(...validSegments(result.segments, target))
            if (!result.next) return segments
            if (result.next === cursor) {
                throw new InsightError('HISTORY_CORRUPT', 'History repository repeated a cursor')
            }
            cursor = result.next
        }
        throw new InsightError('HISTORY_CORRUPT', 'History repository exceeded the page limit')
    }

    #reductions(target: HistoryTarget, range: TimeRange): readonly HistoryReduction[] {
        return (this.#options.policies ?? []).flatMap((policy) =>
            policyMatches(policy, target, range) ? policy.transformations : [],
        )
    }

    #replace(target: HistoryTarget, range: TimeRange, segments: readonly HistorySegment[]) {
        return this.#instrument('insight.history.write', historyAttributes(target), () =>
            this.#options.repository.replace({ ...target, range }, segments),
        )
    }

    #retentionBoundary(): string {
        const maxAgeMs = this.#options.retention?.maxAgeMs
        if (!maxAgeMs) {
            throw new InsightError(
                'INVALID_QUERY',
                'History expire requires before or retention.maxAgeMs',
            )
        }
        return new Date(this.#context.now().valueOf() - maxAgeMs).toISOString()
    }

    #select(selection: HistorySelection): RuntimeSource[] {
        this.#validateSelections(selection)
        return this.#sources.filter(
            (source) =>
                (!selection.scopes || selection.scopes.includes(source.scope)) &&
                (!selection.capabilities ||
                    selection.capabilities.includes(source.definition.contract.name)),
        )
    }

    #split(target: HistoryTarget, range: TimeRange): TimeRange[] {
        const boundaries = (this.#options.policies ?? [])
            .filter((policy) => policyMatches(policy, target, range) && policy.range)
            .flatMap(({ range: policyRange }) => {
                const normalized = normalizeTimeRange(policyRange!)
                return [normalized.from, normalized.to]
            })
            .filter((value) => value > range.from && value < range.to)
        const points = [range.from, ...new Set(boundaries), range.to].toSorted()
        return points.slice(0, -1).map((from, index) => ({ from, to: points[index + 1]! }))
    }

    #validateSelections(selection: HistorySelection): void {
        const scopes = new Set(this.#sources.map(({ scope }) => scope))
        const capabilities = new Set(
            this.#sources.map(({ definition }) => definition.contract.name),
        )
        for (const scope of selection.scopes ?? []) {
            if (!scopes.has(scope)) {
                throw new InsightError('SOURCE_NOT_FOUND', `Unknown History Scope: ${scope}`)
            }
        }
        for (const capability of selection.capabilities ?? []) {
            if (!capabilities.has(capability)) {
                throw new InsightError(
                    'CAPABILITY_UNAVAILABLE',
                    `Unknown History capability: ${capability}`,
                )
            }
        }
    }
}

async function applyReductions(
    input: readonly unknown[],
    reductions: readonly HistoryReduction[],
    context: HistoryReductionContext,
    itemId: (item: unknown, index: number) => string,
): Promise<{ fidelity: HistoryFidelity; items: readonly unknown[] }> {
    let items = input
    const transformations: HistoryTransformation[] = []
    for (const reduction of reductions) {
        if (reduction.kind === 'sample') {
            if (!(reduction.rate > 0 && reduction.rate <= 1)) {
                throw new InsightError('INVALID_QUERY', 'History sample rate must be in (0, 1]')
            }
            items = items.filter((item, index) => sampled(itemId(item, index), reduction.rate))
            transformations.push({ kind: 'sample', rate: reduction.rate })
        } else if (reduction.kind === 'filter') {
            items = items.filter((item) => reduction.test(item, context))
            transformations.push({ id: reduction.id, kind: 'filter' })
        } else if (reduction.kind === 'truncate') {
            if (!Number.isInteger(reduction.limit) || reduction.limit < 0) {
                throw new InsightError(
                    'INVALID_QUERY',
                    'History truncate limit must be non-negative',
                )
            }
            items = items.slice(0, reduction.limit)
            transformations.push({ kind: 'truncate', limit: reduction.limit })
        } else {
            items = await reduction.transform(items, context)
            transformations.push({ id: reduction.id, kind: 'custom' })
        }
    }
    return {
        fidelity: {
            preservation: transformations.length === 0 ? 'full' : 'reduced',
            transformations,
        },
        items,
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

const validSegments = (
    segments: readonly HistorySegment[],
    target: HistoryTarget,
): HistorySegment[] =>
    segments.map((segment) => {
        if (
            segment.schemaVersion !== 2 ||
            segment.scope !== target.scope ||
            segment.capability !== target.capability ||
            segment.adapter !== target.adapter ||
            (!segment.empty && segment.data === undefined) ||
            !validFidelity(segment.fidelity)
        ) {
            throw new InsightError(
                'HISTORY_CORRUPT',
                `Invalid History segment for "${target.scope}.${target.capability}"`,
            )
        }
        return segment
    })

const fidelityBands = (
    segments: readonly HistorySegment[],
    range: TimeRange,
): HistoryFidelityBand[] => {
    const bands = new Map<string, HistoryFidelityBand>()
    for (const segment of segments) {
        const overlap = intersection(range, segment.range)
        if (!overlap) continue
        const band = { ...segment.fidelity, range: overlap }
        bands.set(JSON.stringify(band), band)
    }
    return [...bands.values()].toSorted((left, right) =>
        left.range.from.localeCompare(right.range.from),
    )
}

const emptySegment = (
    target: HistoryTarget,
    range: TimeRange,
    observedAt: string,
    fidelity: HistoryFidelity,
    quality: QueryQuality | undefined,
    provisional: boolean,
): HistorySegment => ({
    ...target,
    empty: true,
    fidelity,
    id: segmentId(target, range, 'empty'),
    observedAt,
    ...(provisional ? { provisional: true } : {}),
    ...(quality ? { quality } : {}),
    range,
    schemaVersion: 2,
    sortKey: '',
})

const dedupeSegments = (segments: readonly HistorySegment[]): HistorySegment[] => [
    ...new Map(segments.map((segment) => [segment.id, segment])).values(),
]

const historyTarget = (source: RuntimeSource): HistoryTarget => ({
    adapter: source.id,
    capability: source.definition.contract.name,
    scope: source.scope,
})

const historyAttributes = (target: HistoryTarget) => ({
    'insight.adapter': target.adapter,
    'insight.capability': target.capability,
    'insight.scope': target.scope,
})

const policyMatches = (policy: HistoryPolicy, target: HistoryTarget, range: TimeRange): boolean =>
    (!policy.scope || policy.scope === target.scope) &&
    (!policy.capability || policy.capability === target.capability) &&
    (!policy.range || intersection(normalizeTimeRange(policy.range), range) !== undefined)

const isProvisional = (
    quality: QueryQuality | undefined,
    meta: object | undefined,
    range: TimeRange,
): boolean => {
    const freshness = isRecord(meta) && isRecord(meta.freshness) ? meta.freshness : undefined
    return Boolean(
        quality?.partial ||
        (freshness &&
            typeof freshness.incompleteFrom === 'string' &&
            freshness.incompleteFrom < range.to &&
            freshness.completeThrough !== range.to),
    )
}

const mergeQuality = (values: readonly (QueryQuality | undefined)[]): QueryQuality | undefined => {
    const present = values.filter((value): value is QueryQuality => value !== undefined)
    if (present.length === 0) return undefined
    const warnings = present.flatMap(({ warnings: items }) => items ?? [])
    const rates = present.flatMap(({ sampleRate }) =>
        sampleRate === undefined ? [] : [sampleRate],
    )
    return {
        ...(present.some(({ approximate }) => approximate) ? { approximate: true } : {}),
        ...(present.some(({ partial }) => partial) ? { partial: true } : {}),
        ...(present.some(({ sampled: value }) => value) ? { sampled: true } : {}),
        ...(rates.length > 0 ? { sampleRate: Math.min(...rates) } : {}),
        ...(present.some(({ thresholded }) => thresholded) ? { thresholded: true } : {}),
        ...(warnings.length > 0 ? { warnings } : {}),
    }
}

const encodeCursor = (cursor: string, target: HistoryTarget): string =>
    `${cursorPrefix}${encodeBase64(JSON.stringify({ cursor, target }))}`

const decodeCursor = (cursor: string | undefined, target: HistoryTarget): string | undefined => {
    if (!cursor) return undefined
    if (!cursor.startsWith(cursorPrefix)) throw invalidCursor()
    try {
        const value: unknown = JSON.parse(decodeBase64(cursor.slice(cursorPrefix.length)))
        if (
            !isRecord(value) ||
            typeof value.cursor !== 'string' ||
            !sameTarget(value.target, target)
        ) {
            throw invalidCursor()
        }
        return value.cursor
    } catch (error) {
        if (error instanceof InsightError) throw error
        throw invalidCursor()
    }
}

const encodeBase64 = (value: string): string => {
    const bytes = new TextEncoder().encode(value)
    let binary = ''
    for (const byte of bytes) binary += String.fromCharCode(byte)
    return btoa(binary).replaceAll('+', '-').replaceAll('/', '_').replace(/=+$/, '')
}

const decodeBase64 = (value: string): string => {
    const encoded = value.replaceAll('-', '+').replaceAll('_', '/')
    const binary = atob(encoded.padEnd(Math.ceil(encoded.length / 4) * 4, '='))
    return new TextDecoder('utf-8', { fatal: true }).decode(
        Uint8Array.from(binary, (character) => character.charCodeAt(0)),
    )
}

const sameTarget = (value: unknown, target: HistoryTarget): boolean =>
    isRecord(value) &&
    value.adapter === target.adapter &&
    value.capability === target.capability &&
    value.scope === target.scope

const segmentId = (target: HistoryTarget, range: TimeRange, item: string): string =>
    `${target.scope}:${target.adapter}:${range.from}:${range.to}:${item}`

const sampled = (value: string, rate: number): boolean => {
    let hash = 2_166_136_261
    for (let index = 0; index < value.length; index += 1) {
        hash = Math.imul(hash ^ value.charCodeAt(index), 16_777_619)
    }
    return (hash >>> 0) / 0x1_0000_0000 < rate
}

const positiveInteger = (value: number, name: string): number => {
    if (!Number.isInteger(value) || value <= 0) throw new TypeError(`${name} must be positive`)
    return value
}

const validFidelity = (value: unknown): value is HistoryFidelity =>
    isRecord(value) &&
    ['full', 'reduced', 'not-preserved'].includes(String(value.preservation)) &&
    Array.isArray(value.transformations)

const intersection = (left: TimeRange, right: TimeRange): TimeRange | undefined => {
    const from = left.from > right.from ? left.from : right.from
    const to = left.to < right.to ? left.to : right.to
    return from < to ? { from, to } : undefined
}

const isRecord = (value: unknown): value is Record<string, unknown> =>
    typeof value === 'object' && value !== null && !Array.isArray(value)

const invalidCursor = () => new InsightError('INVALID_QUERY', 'Invalid History cursor')
const cursorPrefix = 'history:v2:'
const epoch = new Date(0).toISOString()

export type { HistoryFidelity, HistoryFidelityBand, HistoryTransformation }
