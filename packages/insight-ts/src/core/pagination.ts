import { InsightError } from './errors.ts'
import type { InsightCursor } from './types.ts'

export interface ContinuationPage<T> {
    buffer: readonly T[]
    nativeCursor?: string
    terminal: boolean
}

export interface ContinuationState<T> {
    pages: readonly ContinuationPage<T>[]
    seen: readonly string[]
}

export interface ContinuationContribution<T> {
    index: number
    nativeCursor?: string
    records: readonly T[]
}

export const initialContinuation = <T>(count: number): ContinuationState<T> => ({
    pages: Array.from({ length: count }, () => ({ buffer: [], terminal: false })),
    seen: [],
})

export const shouldFetchContinuation = <T>(page: ContinuationPage<T>, limit?: number): boolean =>
    !page.terminal && (limit === undefined || page.buffer.length < limit)

export const mergeContinuation = <T>(options: {
    compare(left: T, right: T): number
    contributions: readonly ContinuationContribution<T>[]
    id(record: T): string
    limit?: number
    state: ContinuationState<T>
}): { records: readonly T[]; state?: ContinuationState<T> } => {
    const pages = options.state.pages.map((page) => ({ ...page, buffer: [...page.buffer] }))
    for (const contribution of options.contributions) {
        const page = pages[contribution.index]
        if (!page) throw invalidCursor()
        if (
            contribution.nativeCursor !== undefined &&
            contribution.nativeCursor === page.nativeCursor
        ) {
            throw new InsightError('INVALID_QUERY', 'Adapter returned a repeated native cursor')
        }
        page.buffer.push(...contribution.records)
        if (contribution.nativeCursor === undefined) delete page.nativeCursor
        else page.nativeCursor = contribution.nativeCursor
        page.terminal = contribution.nativeCursor === undefined
    }

    const seen = new Set(options.state.seen)
    const pageSeen = new Set<string>()
    const entries = pages
        .flatMap((page, index) => page.buffer.map((record) => ({ index, record })))
        .toSorted(
            (left, right) => options.compare(left.record, right.record) || left.index - right.index,
        )
        .filter(({ record }) => {
            const id = options.id(record)
            if (seen.has(id) || pageSeen.has(id)) return false
            pageSeen.add(id)
            return true
        })
    const emitted = entries.slice(0, options.limit)
    for (const { record } of emitted) seen.add(options.id(record))
    const emittedIds = new Set(emitted.map(({ record }) => options.id(record)))
    for (const page of pages) page.buffer = []
    for (const entry of entries) {
        if (!emittedIds.has(options.id(entry.record))) pages[entry.index]!.buffer.push(entry.record)
    }
    const continued = pages.some((page) => page.buffer.length > 0 || !page.terminal)
    return {
        records: emitted.map(({ record }) => record),
        ...(continued ? { state: { pages, seen: [...seen] } } : {}),
    }
}

export const encodeContinuation = <T>(
    capability: string,
    query: string,
    state: ContinuationState<T>,
): InsightCursor => {
    const json = JSON.stringify({ capability, query, state, version: 1 })
    const bytes = new TextEncoder().encode(json)
    let binary = ''
    for (const byte of bytes) binary += String.fromCharCode(byte)
    const cursor = `insight:v1:${btoa(binary).replaceAll('+', '-').replaceAll('/', '_').replace(/=+$/, '')}`
    if (cursor.length > maximumCursorLength) {
        throw new InsightError('UNSUPPORTED_OPERATION', 'Pagination frontier is too large')
    }
    return cursor
}

export const decodeContinuation = <T>(options: {
    adapters: number
    capability: string
    cursor: unknown
    query: string
    records(value: unknown): readonly T[]
}): ContinuationState<T> => {
    if (
        typeof options.cursor !== 'string' ||
        !options.cursor.startsWith(cursorPrefix) ||
        options.cursor.length > maximumCursorLength
    ) {
        throw invalidCursor()
    }
    try {
        const encoded = options.cursor
            .slice(cursorPrefix.length)
            .replaceAll('-', '+')
            .replaceAll('_', '/')
        const binary = atob(encoded.padEnd(Math.ceil(encoded.length / 4) * 4, '='))
        const bytes = Uint8Array.from(binary, (character) => character.charCodeAt(0))
        const envelope = requireRecord(
            JSON.parse(new TextDecoder('utf-8', { fatal: true }).decode(bytes)),
        )
        if (
            envelope.version !== 1 ||
            envelope.capability !== options.capability ||
            envelope.query !== options.query
        ) {
            throw invalidCursor()
        }
        const state = requireRecord(envelope.state)
        if (
            !Array.isArray(state.pages) ||
            state.pages.length !== options.adapters ||
            !Array.isArray(state.seen) ||
            state.seen.some((id) => typeof id !== 'string')
        ) {
            throw invalidCursor()
        }
        return {
            pages: state.pages.map((value) => {
                const page = requireRecord(value)
                if (
                    typeof page.terminal !== 'boolean' ||
                    (page.nativeCursor !== undefined &&
                        (typeof page.nativeCursor !== 'string' || page.nativeCursor.length === 0))
                ) {
                    throw invalidCursor()
                }
                return {
                    buffer: options.records(page.buffer),
                    ...(typeof page.nativeCursor === 'string'
                        ? { nativeCursor: page.nativeCursor }
                        : {}),
                    terminal: page.terminal,
                }
            }),
            seen: [...state.seen],
        }
    } catch (error) {
        if (error instanceof InsightError) throw error
        throw invalidCursor()
    }
}

const cursorPrefix = 'insight:v1:'
const maximumCursorLength = 1024 * 1024
const invalidCursor = (): InsightError =>
    new InsightError('INVALID_QUERY', 'Invalid or mismatched Insight cursor')
const requireRecord = (value: unknown): Record<string, unknown> => {
    if (typeof value !== 'object' || value === null || Array.isArray(value)) throw invalidCursor()
    return Object.fromEntries(Object.entries(value))
}
