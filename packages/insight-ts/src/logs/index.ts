import { InsightError } from '../core/errors.ts'
import {
    decodeContinuation,
    encodeContinuation,
    initialContinuation,
    mergeContinuation,
    shouldFetchContinuation,
    type ContinuationState,
} from '../core/pagination.ts'
import { normalizeTimeRange, normalizeTimestamp, type TimeRange } from '../core/time.ts'
import type {
    AdapterExecutionContext,
    CapabilityAdapterDefinition,
    CapabilityContract,
    CapabilityContribution,
    CapabilitySchema,
    HistoryFidelityBand,
    HistoryMaterializer,
    InsightCursor,
    QueryQuality,
} from '../core/types.ts'

export type LogSeverity = 'trace' | 'debug' | 'info' | 'warn' | 'error' | 'fatal'
export type LogScalar = boolean | number | string | null
export type LogFilterOperator = 'eq' | 'ne' | 'in' | 'notIn'
export type LogFilterField = 'environment' | 'service' | 'severity' | 'spanId' | 'traceId'

export type LogCondition<T extends LogScalar = LogScalar> =
    | T
    | {
          eq?: T
          in?: readonly T[]
          ne?: T
          notIn?: readonly T[]
      }

export interface LogWhere {
    attributes?: Readonly<Record<string, LogCondition>>
    environment?: LogCondition<string>
    service?: LogCondition<string>
    severity?: LogCondition<LogSeverity>
    spanId?: LogCondition<string>
    traceId?: LogCondition<string>
}

export interface LogRecord {
    attributes?: Readonly<Record<string, unknown>>
    body?: unknown
    environment?: string
    id: string
    observedTimestamp?: string
    service?: string
    severity?: LogSeverity
    severityText?: string
    spanId?: string
    timestamp: string
    traceId?: string
}

export interface LogData {
    logs: readonly LogRecord[]
}

export interface LogMeta {
    fidelity?: readonly HistoryFidelityBand[]
}

export interface LogQuery {
    cursor?: InsightCursor
    limit?: number
    time: TimeRange
    where?: LogWhere
}

export interface CanonicalLogFilter {
    field: LogFilterField | `attributes.${string}`
    operator: LogFilterOperator
    value: LogScalar | readonly LogScalar[]
}

export interface NormalizedLogQuery {
    cursor?: InsightCursor
    limit?: number
    nativeCursor?: string
    time: TimeRange
    where?: readonly CanonicalLogFilter[]
}

export interface LogAdapterOutput {
    logs: readonly LogRecord[]
    nativeCursor?: string
    quality?: QueryQuality
}

type LogCapabilitySchema = CapabilitySchema<LogQuery, LogData, LogMeta>
type LogContract = CapabilityContract<'logs', NormalizedLogQuery>

export interface LogAdapterDefinition extends CapabilityAdapterDefinition<
    'logs',
    LogCapabilitySchema,
    LogQuery,
    NormalizedLogQuery,
    LogData,
    LogMeta
> {
    attributes: true | readonly string[]
    filters: readonly LogFilterField[]
    logAdapter: true
}

export interface LogAdapterOptions {
    attributes?: true | readonly string[]
    execute(
        query: NormalizedLogQuery,
        context: AdapterExecutionContext,
    ): LogAdapterOutput | Promise<LogAdapterOutput>
    filters?: readonly LogFilterField[]
}

export const defineLogAdapter = (options: LogAdapterOptions): LogAdapterDefinition => {
    const filters = unique(options.filters ?? [])
    const attributes = options.attributes ?? []
    return {
        attributes,
        contract: logContract,
        async execute(query, context) {
            const output = await options.execute(query, context)
            return {
                data: { logs: normalizeLogs(output.logs) },
                ...(output.nativeCursor ? { nativeCursor: output.nativeCursor } : {}),
                ...(output.quality ? { quality: output.quality } : {}),
            }
        },
        filters,
        key: (query) => JSON.stringify(query),
        logAdapter: true,
        materialize: logHistoryMaterializer,
        normalize: (query) => normalizeLogQuery(query, filters, attributes),
    }
}

const logContract: LogContract = {
    key: (query) => JSON.stringify(query),
    merge(query, contributions) {
        const context = requirePaginationContext(query)
        const merged = mergeContinuation({
            compare: compareLogs,
            contributions: contributions.map((contribution) => {
                const index = context.adapters.findIndex(
                    (adapter) => adapter === contribution.adapter.definition,
                )
                if (index < 0) throw new InsightError('INVALID_QUERY', 'Invalid Log contribution')
                return {
                    index,
                    ...(contribution.result.nativeCursor
                        ? { nativeCursor: contribution.result.nativeCursor }
                        : {}),
                    records: requireLogData(contribution.result.data).logs,
                }
            }),
            id: (log) => log.id,
            ...(query.limit === undefined ? {} : { limit: query.limit }),
            state: context.state,
        })
        const next = merged.state
            ? encodeContinuation('logs', context.key, merged.state)
            : undefined
        return {
            contributions: contributions.map(({ result }) => ({
                fields: logFields(requireLogData(result.data).logs),
                ...(result.quality ? { quality: result.quality } : {}),
            })),
            data: { logs: merged.records },
            ...mergeLogMeta(contributions),
            ...(next ? { pagination: { next } } : {}),
        }
    },
    name: 'logs',
    normalize(input, adapters) {
        const logs = logAdapters(adapters)
        const query = normalizeLogQuery(input, commonFilters(logs), commonAttributes(logs))
        const key = logicalLogKey(query)
        logPagination.set(query, {
            adapters: logs,
            key,
            state: query.cursor
                ? decodeContinuation({
                      adapters: logs.length,
                      capability: 'logs',
                      cursor: query.cursor,
                      query: key,
                      records: normalizeLogs,
                  })
                : initialContinuation(logs.length),
        })
        return query
    },
    plan(query, adapter) {
        if (!isLogAdapter(adapter)) return undefined
        const context = requirePaginationContext(query)
        const index = context.adapters.indexOf(adapter)
        const page = context.state.pages[index]
        if (index < 0 || !page || !shouldFetchContinuation(page, query.limit)) return undefined
        return {
            ...(query.limit === undefined ? {} : { limit: query.limit }),
            ...(page.nativeCursor ? { nativeCursor: page.nativeCursor } : {}),
            time: query.time,
            ...(query.where ? { where: query.where } : {}),
        }
    },
}

interface LogPaginationContext {
    adapters: readonly LogAdapterDefinition[]
    key: string
    state: ContinuationState<LogRecord>
}

const logPagination = new WeakMap<object, LogPaginationContext>()
const requirePaginationContext = (query: NormalizedLogQuery): LogPaginationContext => {
    const context = logPagination.get(query)
    if (!context) throw new InsightError('INVALID_QUERY', 'Missing Log pagination state')
    return context
}

const logicalLogKey = ({ cursor: _cursor, nativeCursor: _native, ...query }: NormalizedLogQuery) =>
    JSON.stringify(query)

const compareLogs = (left: LogRecord, right: LogRecord): number =>
    right.timestamp.localeCompare(left.timestamp) || left.id.localeCompare(right.id)

const logHistoryMaterializer: HistoryMaterializer<NormalizedLogQuery, LogData, LogMeta> = {
    capture: (time) => ({ limit: historyPageSize, time: normalizeTimeRange(time) }),
    continue: (query, nativeCursor) => ({ ...query, nativeCursor }),
    cursor: (query) => query.nativeCursor,
    itemId(item) {
        const [log] = normalizeLogs([item])
        return log!.id
    },
    items: ({ logs }) => normalizeLogs(logs),
    limit: (query) => query.limit,
    materialize(query, items) {
        const logs = normalizeLogs(items)
            .filter(
                (log) =>
                    log.timestamp >= query.time.from &&
                    log.timestamp < query.time.to &&
                    matchesLogWhere(log, query.where),
            )
            .toSorted(compareLogs)
            .slice(0, query.limit)
        return { data: { logs } }
    },
    range: (query) => query.time,
    read: 'bounded',
    sortKey(item) {
        const [log] = normalizeLogs([item])
        return log!.timestamp
    },
}

const historyPageSize = 1000

const matchesLogWhere = (
    log: LogRecord,
    where: readonly CanonicalLogFilter[] | undefined,
): boolean =>
    (where ?? []).every((filter) => {
        const value = filter.field.startsWith('attributes.')
            ? log.attributes?.[filter.field.slice('attributes.'.length)]
            : Reflect.get(log, filter.field)
        if (filter.operator === 'eq') return value === filter.value
        if (filter.operator === 'ne') return value !== filter.value
        const selected = Array.isArray(filter.value) ? filter.value : [filter.value]
        const includes = selected.some((item) => item === value)
        return filter.operator === 'in' ? includes : !includes
    })

const mergeLogMeta = (contributions: readonly CapabilityContribution[]): { meta?: LogMeta } => {
    const fidelity = contributions.flatMap(({ result }) => {
        if (!isRecord(result.meta) || !Array.isArray(result.meta.fidelity)) return []
        return result.meta.fidelity.filter(isHistoryFidelityBand)
    })
    return fidelity.length > 0 ? { meta: { fidelity } } : {}
}

const isHistoryFidelityBand = (value: unknown): value is HistoryFidelityBand =>
    isRecord(value) &&
    typeof value.preservation === 'string' &&
    ['full', 'reduced', 'not-preserved'].includes(value.preservation) &&
    Array.isArray(value.transformations) &&
    isRecord(value.range) &&
    typeof value.range.from === 'string' &&
    typeof value.range.to === 'string'

const normalizeLogQuery = (
    input: unknown,
    filters: readonly LogFilterField[],
    attributes: true | readonly string[],
): NormalizedLogQuery => {
    const query = requireRecord(input, 'Log query')
    const time = requireRecord(query.time, 'time')
    if (typeof time.from !== 'string' || typeof time.to !== 'string') {
        throw new InsightError('INVALID_QUERY', 'Time from and to must be ISO strings')
    }
    if (query.limit !== undefined && (!Number.isInteger(query.limit) || Number(query.limit) <= 0)) {
        throw new InsightError('INVALID_QUERY', 'Query limit must be a positive integer')
    }
    if (query.cursor !== undefined && typeof query.cursor !== 'string') {
        throw new InsightError('INVALID_QUERY', 'Log cursor must be an opaque string')
    }
    return {
        ...(typeof query.cursor === 'string' ? { cursor: query.cursor } : {}),
        ...(typeof query.limit === 'number' ? { limit: query.limit } : {}),
        time: normalizeTimeRange({ from: time.from, to: time.to }),
        ...(query.where === undefined
            ? {}
            : { where: normalizeLogWhere(query.where, filters, attributes) }),
    }
}

const normalizeLogWhere = (
    input: unknown,
    supportedFields: readonly LogFilterField[],
    supportedAttributes: true | readonly string[],
): readonly CanonicalLogFilter[] => {
    const where = requireRecord(input, 'where')
    const filters: CanonicalLogFilter[] = []
    for (const field of Object.keys(where).toSorted()) {
        if (field === 'attributes') {
            const attributes = requireRecord(where.attributes, 'where.attributes')
            for (const attribute of Object.keys(attributes).toSorted()) {
                if (supportedAttributes !== true && !supportedAttributes.includes(attribute)) {
                    throw unsupportedFilter(`attributes.${attribute}`)
                }
                filters.push(
                    ...normalizeCondition(`attributes.${attribute}`, attributes[attribute]),
                )
            }
            continue
        }
        if (!isLogFilterField(field) || !supportedFields.includes(field)) {
            throw unsupportedFilter(field)
        }
        filters.push(...normalizeCondition(field, where[field]))
    }
    return filters
}

const normalizeCondition = (
    field: CanonicalLogFilter['field'],
    input: unknown,
): CanonicalLogFilter[] => {
    if (isScalar(input)) return [{ field, operator: 'eq', value: input }]
    const condition = requireRecord(input, `where.${field}`)
    const filters: CanonicalLogFilter[] = []
    for (const operator of Object.keys(condition).toSorted()) {
        if (!isLogFilterOperator(operator)) {
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
                value.some((item) => !isScalar(item))
            ) {
                throw new InsightError('INVALID_QUERY', `where.${field}.${operator} is invalid`)
            }
            filters.push({ field, operator, value })
        } else if (isScalar(value)) {
            filters.push({ field, operator, value })
        } else {
            throw new InsightError('INVALID_QUERY', `where.${field}.${operator} is invalid`)
        }
    }
    if (filters.length === 0) {
        throw new InsightError('INVALID_QUERY', `where.${field} cannot be empty`)
    }
    return filters
}

const normalizeLogs = (logs: unknown): readonly LogRecord[] => {
    if (!Array.isArray(logs))
        throw new InsightError('INVALID_QUERY', 'Log adapter returned invalid data')
    return logs.map((log) => {
        if (!isRecord(log) || typeof log.id !== 'string' || log.id.length === 0) {
            throw new InsightError('INVALID_QUERY', 'Log records require a stable non-empty id')
        }
        if (typeof log.timestamp !== 'string') {
            throw new InsightError('INVALID_QUERY', 'Log records require a timestamp')
        }
        for (const field of optionalLogStrings) {
            if (log[field] !== undefined && typeof log[field] !== 'string') {
                throw new InsightError('INVALID_QUERY', `Log ${field} must be a string`)
            }
        }
        if (log.attributes !== undefined && !isRecord(log.attributes)) {
            throw new InsightError('INVALID_QUERY', 'Log attributes must be an object')
        }
        if (log.severity !== undefined && !logSeverities.has(log.severity)) {
            throw new InsightError(
                'INVALID_QUERY',
                `Unsupported log severity: ${JSON.stringify(log.severity)}`,
            )
        }
        // The required and optional canonical fields are validated above.
        // eslint-disable-next-line typescript/no-unsafe-type-assertion
        const record = log as unknown as LogRecord
        return {
            ...record,
            ...(typeof record.observedTimestamp === 'string'
                ? {
                      observedTimestamp: normalizeTimestamp(
                          record.observedTimestamp,
                          'Log observed time',
                      ),
                  }
                : {}),
            timestamp: normalizeTimestamp(record.timestamp, 'Log timestamp'),
        }
    })
}

const requireLogData = (value: unknown): LogData => {
    if (!isRecord(value) || !Array.isArray(value.logs)) {
        throw new InsightError('INVALID_QUERY', 'Log adapter returned invalid data')
    }
    return { logs: normalizeLogs(value.logs) }
}

const logFields = (logs: readonly LogRecord[]): readonly string[] =>
    [...new Set(logs.flatMap((log) => Object.keys(log)))].toSorted()

const commonFilters = (adapters: readonly LogAdapterDefinition[]): readonly LogFilterField[] =>
    adapters.length === 0
        ? []
        : adapters[0]!.filters.filter((field) =>
              adapters.slice(1).every((adapter) => adapter.filters.includes(field)),
          )

const commonAttributes = (adapters: readonly LogAdapterDefinition[]): true | readonly string[] => {
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

const logAdapters = (adapters: readonly object[]): LogAdapterDefinition[] => {
    const logs = adapters.filter(isLogAdapter)
    if (logs.length !== adapters.length) {
        throw new InsightError('INVALID_QUERY', 'Logs contract received an invalid adapter')
    }
    return logs
}

const unsupportedFilter = (field: string): InsightError =>
    new InsightError('UNSUPPORTED_OPERATION', `Unsupported log filter: ${field}`)

const unique = <T>(values: readonly T[]): readonly T[] => [...new Set(values)]
const isRecord = (value: unknown): value is Record<string, unknown> =>
    typeof value === 'object' && value !== null && !Array.isArray(value)
const requireRecord = (value: unknown, name: string): Record<string, unknown> => {
    if (!isRecord(value)) throw new InsightError('INVALID_QUERY', `${name} must be an object`)
    return value
}
const isScalar = (value: unknown): value is LogScalar =>
    value === null || ['boolean', 'number', 'string'].includes(typeof value)
const logSeverities = new Set<unknown>(['trace', 'debug', 'info', 'warn', 'error', 'fatal'])
const optionalLogStrings = [
    'environment',
    'observedTimestamp',
    'service',
    'severityText',
    'spanId',
    'traceId',
] as const
const logFilterFields = new Set<string>(['environment', 'service', 'severity', 'spanId', 'traceId'])
const isLogFilterField = (value: string): value is LogFilterField => logFilterFields.has(value)
const logFilterOperators = new Set<string>(['eq', 'ne', 'in', 'notIn'])
const isLogFilterOperator = (value: string): value is LogFilterOperator =>
    logFilterOperators.has(value)
const isLogAdapter = (value: object): value is LogAdapterDefinition =>
    isRecord(value) &&
    value.logAdapter === true &&
    Array.isArray(value.filters) &&
    (value.attributes === true || Array.isArray(value.attributes))
