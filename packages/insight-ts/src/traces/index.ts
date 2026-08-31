import { InsightError } from '../core/errors.ts'
import { normalizeTimeRange, normalizeTimestamp, type TimeRange } from '../core/time.ts'
import type {
    AdapterExecutionContext,
    CapabilityAdapterDefinition,
    CapabilityContract,
    CapabilityContribution,
    CapabilitySchema,
    QueryQuality,
} from '../core/types.ts'

export type TraceStatus = 'unset' | 'ok' | 'error'
export type SpanKind = 'internal' | 'server' | 'client' | 'producer' | 'consumer'
export type TraceScalar = boolean | number | string | null
export type TraceFilterOperator = 'eq' | 'ne' | 'gt' | 'gte' | 'lt' | 'lte' | 'in' | 'notIn'
export type TraceFilterField =
    | 'durationMs'
    | 'environment'
    | 'name'
    | 'service'
    | 'status'
    | 'traceId'

export type TraceCondition<T extends TraceScalar = TraceScalar> =
    | T
    | {
          eq?: T
          gt?: T
          gte?: T
          in?: readonly T[]
          lt?: T
          lte?: T
          ne?: T
          notIn?: readonly T[]
      }

export interface TraceWhere {
    attributes?: Readonly<Record<string, TraceCondition>>
    durationMs?: TraceCondition<number>
    environment?: TraceCondition<string>
    name?: TraceCondition<string>
    service?: TraceCondition<string>
    status?: TraceCondition<TraceStatus>
    traceId?: TraceCondition<string>
}

export interface TraceSpan {
    attributes?: Readonly<Record<string, unknown>>
    durationMs?: number
    endTime?: string
    id: string
    kind?: SpanKind
    name: string
    parentSpanId?: string
    service?: string
    startTime: string
    status?: TraceStatus
    traceId: string
}

export interface TraceRecord {
    attributes?: Readonly<Record<string, unknown>>
    durationMs?: number
    endTime?: string
    environment?: string
    name?: string
    rootSpanId?: string
    service?: string
    spanCount?: number
    spans?: readonly TraceSpan[]
    startTime: string
    status?: TraceStatus
    traceId: string
}

export interface TraceData {
    traces: readonly TraceRecord[]
}

export interface TraceQuery {
    limit?: number
    time: TimeRange
    where?: TraceWhere
}

export interface CanonicalTraceFilter {
    field: TraceFilterField | `attributes.${string}`
    operator: TraceFilterOperator
    value: TraceScalar | readonly TraceScalar[]
}

export interface NormalizedTraceQuery {
    limit?: number
    time: TimeRange
    where?: readonly CanonicalTraceFilter[]
}

export interface TraceAdapterOutput {
    quality?: QueryQuality
    traces: readonly TraceRecord[]
}

type TraceCapabilitySchema = CapabilitySchema<TraceQuery, TraceData>
type TraceContract = CapabilityContract<'traces', NormalizedTraceQuery>

export interface TraceAdapterDefinition extends CapabilityAdapterDefinition<
    'traces',
    TraceCapabilitySchema,
    TraceQuery,
    NormalizedTraceQuery,
    TraceData
> {
    attributes: true | readonly string[]
    filters: readonly TraceFilterField[]
    traceAdapter: true
}

export interface TraceAdapterOptions {
    attributes?: true | readonly string[]
    execute(
        query: NormalizedTraceQuery,
        context: AdapterExecutionContext,
    ): Promise<TraceAdapterOutput> | TraceAdapterOutput
    filters?: readonly TraceFilterField[]
}

export const defineTraceAdapter = (options: TraceAdapterOptions): TraceAdapterDefinition => {
    const filters = unique(options.filters ?? [])
    const attributes = options.attributes ?? []
    return {
        attributes,
        contract: traceContract,
        async execute(query, context) {
            const output = await options.execute(query, context)
            return {
                data: { traces: normalizeTraces(output.traces) },
                ...(output.quality ? { quality: output.quality } : {}),
            }
        },
        filters,
        key: (query) => JSON.stringify(query),
        normalize: (query) => normalizeTraceQuery(query, filters, attributes),
        traceAdapter: true,
    }
}

const traceContract: TraceContract = {
    key: (query) => JSON.stringify(query),
    merge(query, contributions) {
        const traces = new Map<string, TraceRecord>()
        for (const contribution of contributions) {
            for (const trace of requireTraceData(contribution.result.data).traces) {
                if (!traces.has(trace.traceId)) traces.set(trace.traceId, trace)
            }
        }
        return {
            contributions: contributions.map(({ result }) => ({
                fields: traceFields(requireTraceData(result.data).traces),
                ...(result.quality ? { quality: result.quality } : {}),
            })),
            data: {
                traces: [...traces.values()]
                    .toSorted(
                        (left, right) =>
                            right.startTime.localeCompare(left.startTime) ||
                            left.traceId.localeCompare(right.traceId),
                    )
                    .slice(0, query.limit),
            },
        }
    },
    name: 'traces',
    normalize(input, adapters) {
        const traces = traceAdapters(adapters)
        return normalizeTraceQuery(input, commonFilters(traces), commonAttributes(traces))
    },
    plan: (query, adapter) => (isTraceAdapter(adapter) ? query : undefined),
}

const normalizeTraceQuery = (
    input: unknown,
    filters: readonly TraceFilterField[],
    attributes: true | readonly string[],
): NormalizedTraceQuery => {
    const query = requireRecord(input, 'Trace query')
    const time = requireRecord(query.time, 'time')
    if (typeof time.from !== 'string' || typeof time.to !== 'string') {
        throw new InsightError('INVALID_QUERY', 'Time from and to must be ISO strings')
    }
    if (query.limit !== undefined && (!Number.isInteger(query.limit) || Number(query.limit) <= 0)) {
        throw new InsightError('INVALID_QUERY', 'Query limit must be a positive integer')
    }
    return {
        ...(typeof query.limit === 'number' ? { limit: query.limit } : {}),
        time: normalizeTimeRange({ from: time.from, to: time.to }),
        ...(query.where === undefined
            ? {}
            : { where: normalizeTraceWhere(query.where, filters, attributes) }),
    }
}

const normalizeTraceWhere = (
    input: unknown,
    supportedFields: readonly TraceFilterField[],
    supportedAttributes: true | readonly string[],
): readonly CanonicalTraceFilter[] => {
    const where = requireRecord(input, 'where')
    const filters: CanonicalTraceFilter[] = []
    for (const field of Object.keys(where).toSorted()) {
        if (field === 'attributes') {
            const attributes = requireRecord(where.attributes, 'where.attributes')
            for (const attribute of Object.keys(attributes).toSorted()) {
                if (supportedAttributes !== true && !supportedAttributes.includes(attribute)) {
                    throw unsupportedFilter(`attributes.${attribute}`)
                }
                filters.push(
                    ...normalizeCondition(
                        `attributes.${attribute}`,
                        attributes[attribute],
                        'scalar',
                    ),
                )
            }
            continue
        }
        if (!isTraceFilterField(field) || !supportedFields.includes(field)) {
            throw unsupportedFilter(field)
        }
        filters.push(
            ...normalizeCondition(
                field,
                where[field],
                field === 'durationMs' ? 'number' : field === 'status' ? 'status' : 'string',
            ),
        )
    }
    return filters
}

const normalizeCondition = (
    field: CanonicalTraceFilter['field'],
    input: unknown,
    type: 'number' | 'scalar' | 'status' | 'string',
): CanonicalTraceFilter[] => {
    if (matchesType(input, type)) return [{ field, operator: 'eq', value: input }]
    const condition = requireRecord(input, `where.${field}`)
    const filters: CanonicalTraceFilter[] = []
    for (const operator of Object.keys(condition).toSorted()) {
        if (
            !isTraceFilterOperator(operator) ||
            (type !== 'number' && rangeOperators.has(operator))
        ) {
            throw new InsightError(
                'INVALID_QUERY',
                `where field "${field}" does not support operator "${operator}"`,
            )
        }
        const value = condition[operator]
        if (operator === 'in' || operator === 'notIn') {
            if (
                !Array.isArray(value) ||
                value.length === 0 ||
                value.some((item) => !matchesType(item, type))
            ) {
                throw invalidCondition(field, operator)
            }
            filters.push({ field, operator, value })
        } else if (matchesType(value, type)) {
            filters.push({ field, operator, value })
        } else {
            throw invalidCondition(field, operator)
        }
    }
    if (filters.length === 0) {
        throw new InsightError('INVALID_QUERY', `where.${field} cannot be empty`)
    }
    return filters
}

const normalizeTraces = (traces: readonly TraceRecord[]): readonly TraceRecord[] => {
    if (!Array.isArray(traces)) {
        throw new InsightError('INVALID_QUERY', 'Trace adapter returned invalid data')
    }
    return traces.map((trace) => {
        if (!isRecord(trace) || typeof trace.traceId !== 'string' || trace.traceId.length === 0) {
            throw new InsightError('INVALID_QUERY', 'Trace records require a stable traceId')
        }
        if (typeof trace.startTime !== 'string') {
            throw new InsightError('INVALID_QUERY', 'Trace records require a startTime')
        }
        if (trace.spans !== undefined && !Array.isArray(trace.spans)) {
            throw new InsightError('INVALID_QUERY', 'Trace spans must be an array')
        }
        // All required fields and the optional span container are validated above.
        // eslint-disable-next-line typescript/no-unsafe-type-assertion
        const record = trace as unknown as TraceRecord
        validateStatus(record.status, 'Trace')
        validateCount(record.spanCount, 'Trace spanCount')
        validateDuration(record.durationMs, 'Trace durationMs')
        const spans = record.spans?.map((span) => normalizeSpan(span, record.traceId))
        return {
            ...record,
            ...(typeof record.endTime === 'string'
                ? { endTime: normalizeTimestamp(record.endTime, 'Trace endTime') }
                : {}),
            ...(spans ? { spans, spanCount: record.spanCount ?? spans.length } : {}),
            startTime: normalizeTimestamp(record.startTime, 'Trace startTime'),
        }
    })
}

const normalizeSpan = (span: TraceSpan, traceId: string): TraceSpan => {
    if (
        !isRecord(span) ||
        typeof span.id !== 'string' ||
        span.id.length === 0 ||
        typeof span.name !== 'string' ||
        span.name.length === 0 ||
        span.traceId !== traceId ||
        typeof span.startTime !== 'string'
    ) {
        throw new InsightError('INVALID_QUERY', 'Trace spans require matching IDs, name, and time')
    }
    validateStatus(span.status, 'Span')
    validateDuration(span.durationMs, 'Span durationMs')
    if (span.kind !== undefined && !spanKinds.has(span.kind)) {
        throw new InsightError('INVALID_QUERY', `Unsupported span kind: ${String(span.kind)}`)
    }
    return {
        ...span,
        ...(typeof span.endTime === 'string'
            ? { endTime: normalizeTimestamp(span.endTime, 'Span endTime') }
            : {}),
        startTime: normalizeTimestamp(span.startTime, 'Span startTime'),
    }
}

const requireTraceData = (value: unknown): TraceData => {
    if (!isRecord(value) || !Array.isArray(value.traces)) {
        throw new InsightError('INVALID_QUERY', 'Trace adapter returned invalid data')
    }
    return { traces: normalizeTraces(value.traces as readonly TraceRecord[]) }
}

const validateStatus = (status: unknown, name: string): void => {
    if (status !== undefined && !traceStatuses.has(status)) {
        throw new InsightError(
            'INVALID_QUERY',
            `Unsupported ${name.toLowerCase()} status: ${String(status)}`,
        )
    }
}
const validateDuration = (duration: unknown, name: string): void => {
    if (
        duration !== undefined &&
        (typeof duration !== 'number' || !Number.isFinite(duration) || duration < 0)
    ) {
        throw new InsightError('INVALID_QUERY', `${name} must be a non-negative finite number`)
    }
}
const validateCount = (count: unknown, name: string): void => {
    if (count !== undefined && (!Number.isInteger(count) || Number(count) < 0)) {
        throw new InsightError('INVALID_QUERY', `${name} must be a non-negative integer`)
    }
}
const traceFields = (traces: readonly TraceRecord[]): readonly string[] =>
    [...new Set(traces.flatMap((trace) => Object.keys(trace)))].toSorted()
const commonFilters = (adapters: readonly TraceAdapterDefinition[]): readonly TraceFilterField[] =>
    adapters.length === 0
        ? []
        : adapters[0]!.filters.filter((field) =>
              adapters.slice(1).every((adapter) => adapter.filters.includes(field)),
          )
const commonAttributes = (
    adapters: readonly TraceAdapterDefinition[],
): true | readonly string[] => {
    if (adapters.length === 0) return []
    if (adapters.every((adapter) => adapter.attributes === true)) return true
    const first =
        adapters.flatMap((adapter) =>
            adapter.attributes === true ? [] : [adapter.attributes],
        )[0] ?? []
    return first.filter((attribute) =>
        adapters.every(
            (adapter) => adapter.attributes === true || adapter.attributes.includes(attribute),
        ),
    )
}
const traceAdapters = (adapters: readonly object[]): TraceAdapterDefinition[] => {
    const traces = adapters.filter(isTraceAdapter)
    if (traces.length !== adapters.length) {
        throw new InsightError('INVALID_QUERY', 'Traces contract received an invalid adapter')
    }
    return traces
}
const unsupportedFilter = (field: string): InsightError =>
    new InsightError('UNSUPPORTED_OPERATION', `Unsupported trace filter: ${field}`)
const invalidCondition = (field: string, operator: string): InsightError =>
    new InsightError('INVALID_QUERY', `where.${field}.${operator} is invalid`)
const matchesType = (
    value: unknown,
    type: 'number' | 'scalar' | 'status' | 'string',
): value is TraceScalar =>
    type === 'number'
        ? typeof value === 'number' && Number.isFinite(value)
        : type === 'status'
          ? traceStatuses.has(value)
          : type === 'string'
            ? typeof value === 'string'
            : value === null || ['boolean', 'number', 'string'].includes(typeof value)
const unique = <T>(values: readonly T[]): readonly T[] => [...new Set(values)]
const isRecord = (value: unknown): value is Record<string, unknown> =>
    typeof value === 'object' && value !== null && !Array.isArray(value)
const requireRecord = (value: unknown, name: string): Record<string, unknown> => {
    if (!isRecord(value)) throw new InsightError('INVALID_QUERY', `${name} must be an object`)
    return value
}
const traceStatuses = new Set<unknown>(['unset', 'ok', 'error'])
const spanKinds = new Set<unknown>(['internal', 'server', 'client', 'producer', 'consumer'])
const traceFilterFields = new Set<string>([
    'durationMs',
    'environment',
    'name',
    'service',
    'status',
    'traceId',
])
const isTraceFilterField = (value: string): value is TraceFilterField =>
    traceFilterFields.has(value)
const traceFilterOperators = new Set<string>(['eq', 'ne', 'gt', 'gte', 'lt', 'lte', 'in', 'notIn'])
const isTraceFilterOperator = (value: string): value is TraceFilterOperator =>
    traceFilterOperators.has(value)
const rangeOperators = new Set<string>(['gt', 'gte', 'lt', 'lte'])
const isTraceAdapter = (value: object): value is TraceAdapterDefinition =>
    isRecord(value) &&
    value.traceAdapter === true &&
    Array.isArray(value.filters) &&
    (value.attributes === true || Array.isArray(value.attributes))
