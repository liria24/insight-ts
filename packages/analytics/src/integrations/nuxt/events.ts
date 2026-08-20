import {
    createError,
    defineEventHandler,
    getHeader,
    getRequestURL,
    type EventHandler,
    type H3Event,
} from 'h3'

import type { NuxtAnalyticsEventDefinitions, NuxtAnalyticsServerEvent } from './types'

export interface AnalyticsEventHandlerOptions {
    deliver(events: readonly NuxtAnalyticsServerEvent[], event: H3Event): Promise<void>
    events: NuxtAnalyticsEventDefinitions
    id?: () => string
    maxBatchSize?: number
    maxBodySize?: number
    now?: () => Date
}

export function createAnalyticsEventHandler(options: AnalyticsEventHandlerOptions): EventHandler {
    const maxBatchSize = options.maxBatchSize ?? 20
    const maxBodySize = options.maxBodySize ?? 64 * 1024
    const now = options.now ?? (() => new Date())
    const id = options.id ?? (() => crypto.randomUUID())

    if (!Number.isSafeInteger(maxBatchSize) || maxBatchSize < 1 || maxBatchSize > 100) {
        throw new RangeError('maxBatchSize must be an integer between 1 and 100')
    }
    if (!Number.isSafeInteger(maxBodySize) || maxBodySize < 1 || maxBodySize > 1024 * 1024) {
        throw new RangeError('maxBodySize must be an integer between 1 and 1048576')
    }

    return defineEventHandler(async (event) => {
        const requestOrigin = getRequestURL(event).origin
        const origin = getHeader(event, 'origin')
        if (!origin || origin !== requestOrigin) {
            throw createError({
                statusCode: 403,
                statusMessage: 'Analytics relay is same-origin only',
            })
        }

        const declaredLength = Number(getHeader(event, 'content-length'))
        if (Number.isFinite(declaredLength) && declaredLength > maxBodySize) {
            throw createError({ statusCode: 413, statusMessage: 'Analytics payload is too large' })
        }

        const raw = await readLimitedBody(event, maxBodySize)

        let body: unknown
        try {
            body = JSON.parse(raw)
        } catch {
            throw createError({ statusCode: 400, statusMessage: 'Invalid analytics payload' })
        }

        const inputs = readEventInputs(body, maxBatchSize)
        const timestamp = now().toISOString()
        const events = inputs.map((input) => validateEvent(input, options.events, timestamp, id))
        await options.deliver(events, event)
        return { accepted: events.length }
    })
}

function readEventInputs(body: unknown, maxBatchSize: number): readonly unknown[] {
    if (!isRecord(body) || Object.keys(body).length !== 1 || !Array.isArray(body.events)) {
        throw createError({ statusCode: 400, statusMessage: 'Invalid analytics payload' })
    }

    if (body.events.length < 1 || body.events.length > maxBatchSize) {
        throw createError({ statusCode: 400, statusMessage: 'Invalid analytics batch size' })
    }

    return body.events
}

function validateEvent(
    input: unknown,
    definitions: NuxtAnalyticsEventDefinitions,
    timestamp: string,
    id: () => string,
): NuxtAnalyticsServerEvent {
    if (
        !isRecord(input) ||
        Object.keys(input).some((key) => key !== 'name' && key !== 'properties') ||
        typeof input.name !== 'string' ||
        !isRecord(input.properties)
    ) {
        throw createError({ statusCode: 400, statusMessage: 'Invalid analytics event' })
    }

    const properties = input.properties
    if (!Object.hasOwn(definitions, input.name)) {
        throw createError({ statusCode: 400, statusMessage: 'Unknown analytics event' })
    }
    const definition = definitions[input.name]
    if (!definition)
        throw createError({ statusCode: 400, statusMessage: 'Unknown analytics event' })

    const expected = definition.properties ?? {}
    if (
        Object.keys(properties).length !== Object.keys(expected).length ||
        Object.entries(expected).some(([name, type]) => !matches(type, properties[name]))
    ) {
        throw createError({ statusCode: 400, statusMessage: 'Invalid analytics properties' })
    }

    const normalizedProperties: Record<string, boolean | number | string> = {}
    for (const [name, value] of Object.entries(properties)) {
        if (typeof value === 'boolean' || typeof value === 'number' || typeof value === 'string') {
            normalizedProperties[name] = value
        }
    }

    return {
        id: id(),
        name: input.name,
        origin: 'client',
        properties: normalizedProperties,
        timestamp,
    }
}

function isRecord(value: unknown): value is Record<string, unknown> {
    return typeof value === 'object' && value !== null && !Array.isArray(value)
}

function matches(type: AnalyticsEventProperty, value: unknown): boolean {
    return Array.isArray(type)
        ? typeof value === 'string' && type.includes(value)
        : typeof value === type
}

type AnalyticsEventProperty = 'boolean' | 'number' | 'string' | readonly string[]

async function readLimitedBody(event: H3Event, limit: number): Promise<string> {
    const chunks: Uint8Array[] = []
    let size = 0

    const append = (chunk: unknown): void => {
        const bytes =
            typeof chunk === 'string'
                ? new TextEncoder().encode(chunk)
                : chunk instanceof Uint8Array
                  ? chunk
                  : undefined
        if (!bytes)
            throw createError({ statusCode: 400, statusMessage: 'Invalid analytics payload' })
        size += bytes.byteLength
        if (size > limit) {
            throw createError({ statusCode: 413, statusMessage: 'Analytics payload is too large' })
        }
        chunks.push(bytes)
    }

    const webBody = event.web?.request?.body
    if (webBody) {
        const reader = webBody.getReader()
        try {
            while (true) {
                // A request stream must be read sequentially to enforce the byte limit.
                // oxlint-disable-next-line no-await-in-loop
                const { done, value } = await reader.read()
                if (done) break
                append(value)
            }
        } catch (error) {
            await reader.cancel().catch(() => {})
            throw error
        }
    } else {
        for await (const chunk of event.node.req) append(chunk)
    }

    if (size === 0) {
        throw createError({ statusCode: 400, statusMessage: 'Invalid analytics payload' })
    }

    const body = new Uint8Array(size)
    let offset = 0
    for (const chunk of chunks) {
        body.set(chunk, offset)
        offset += chunk.byteLength
    }
    return new TextDecoder().decode(body)
}
