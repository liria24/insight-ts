import { InsightError } from './errors.ts'
import type { InsightCursor } from './types.ts'

export interface Continuation {
    binding: string
    capability: string
    nativeCursor: string
    query: object
    queryKey: string
    scope: string
}

export const encodeContinuation = (continuation: Continuation): InsightCursor => {
    let json: string
    try {
        json = JSON.stringify({ ...continuation, version: 2 })
    } catch {
        throw new InsightError('UNSUPPORTED_OPERATION', 'Pagination query is not serializable')
    }
    const bytes = new TextEncoder().encode(json)
    let binary = ''
    for (const byte of bytes) binary += String.fromCharCode(byte)
    const cursor = `${cursorPrefix}${btoa(binary).replaceAll('+', '-').replaceAll('/', '_').replace(/=+$/, '')}`
    if (cursor.length > maximumCursorLength) {
        throw new InsightError('UNSUPPORTED_OPERATION', 'Pagination continuation is too large')
    }
    return cursor
}

export const decodeContinuation = (cursor: unknown): Continuation => {
    if (
        typeof cursor !== 'string' ||
        !cursor.startsWith(cursorPrefix) ||
        cursor.length > maximumCursorLength
    ) {
        throw invalidContinuation()
    }
    try {
        const encoded = cursor.slice(cursorPrefix.length).replaceAll('-', '+').replaceAll('_', '/')
        const binary = atob(encoded.padEnd(Math.ceil(encoded.length / 4) * 4, '='))
        const bytes = Uint8Array.from(binary, (character) => character.charCodeAt(0))
        const value = requireRecord(
            JSON.parse(new TextDecoder('utf-8', { fatal: true }).decode(bytes)),
        )
        const query = requireRecord(value.query)
        if (
            value.version !== 2 ||
            !nonEmptyString(value.binding) ||
            !nonEmptyString(value.capability) ||
            !nonEmptyString(value.nativeCursor) ||
            typeof value.queryKey !== 'string' ||
            !nonEmptyString(value.scope)
        ) {
            throw invalidContinuation()
        }
        return {
            binding: value.binding,
            capability: value.capability,
            nativeCursor: value.nativeCursor,
            query,
            queryKey: value.queryKey,
            scope: value.scope,
        }
    } catch (error) {
        if (error instanceof InsightError) throw error
        throw invalidContinuation()
    }
}

export const mergePage = <T>(options: {
    compare(left: T, right: T): number
    id(value: T): string
    limit?: number
    pages: readonly (readonly T[])[]
}): readonly T[] => {
    const seen = new Set<string>()
    return options.pages
        .flat()
        .toSorted((left, right) => options.compare(left, right))
        .filter((value) => {
            const id = options.id(value)
            if (seen.has(id)) return false
            seen.add(id)
            return true
        })
        .slice(0, options.limit)
}

export const invalidContinuation = (): InsightError =>
    new InsightError('INVALID_QUERY', 'Invalid or mismatched Insight continuation')

const cursorPrefix = 'insight:v2:'
const maximumCursorLength = 64 * 1024
const nonEmptyString = (value: unknown): value is string =>
    typeof value === 'string' && value.length > 0
const requireRecord = (value: unknown): Record<string, unknown> => {
    if (typeof value !== 'object' || value === null || Array.isArray(value)) {
        throw invalidContinuation()
    }
    return Object.fromEntries(Object.entries(value))
}
