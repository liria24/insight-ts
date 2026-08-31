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

export interface LogQuery {
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
    limit?: number
    time: TimeRange
    where?: readonly CanonicalLogFilter[]
}

export interface LogAdapterOutput {
    logs: readonly LogRecord[]
    quality?: QueryQuality
}

type LogCapabilitySchema = CapabilitySchema<LogQuery, LogData>
type LogContract = CapabilityContract<'logs', NormalizedLogQuery>

export interface LogAdapterDefinition extends CapabilityAdapterDefinition<
    'logs',
    LogCapabilitySchema,
    LogQuery,
    NormalizedLogQuery,
    LogData
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
                ...(output.quality ? { quality: output.quality } : {}),
            }
        },
        filters,
        key: (query) => JSON.stringify(query),
        logAdapter: true,
        normalize: (query) => normalizeLogQuery(query, filters, attributes),
    }
}

const logContract: LogContract = {
    key: (query) => JSON.stringify(query),
    merge(query, contributions) {
        const logs = new Map<string, LogRecord>()
        for (const contribution of contributions) {
            for (const log of requireLogData(contribution.result.data).logs) {
                if (!logs.has(log.id)) logs.set(log.id, log)
            }
        }
        return {
            contributions: contributions.map(({ result }) => ({
                fields: logFields(requireLogData(result.data).logs),
                ...(result.quality ? { quality: result.quality } : {}),
            })),
            data: {
                logs: [...logs.values()]
                    .toSorted(
                        (left, right) =>
                            right.timestamp.localeCompare(left.timestamp) ||
                            left.id.localeCompare(right.id),
                    )
                    .slice(0, query.limit),
            },
        }
    },
    name: 'logs',
    normalize(input, adapters) {
        const logs = logAdapters(adapters)
        return normalizeLogQuery(input, commonFilters(logs), commonAttributes(logs))
    },
    plan: (query, adapter) => (isLogAdapter(adapter) ? query : undefined),
}

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
    return {
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

const normalizeLogs = (logs: readonly LogRecord[]): readonly LogRecord[] => {
    if (!Array.isArray(logs))
        throw new InsightError('INVALID_QUERY', 'Log adapter returned invalid data')
    return logs.map((log) => {
        if (!isRecord(log) || typeof log.id !== 'string' || log.id.length === 0) {
            throw new InsightError('INVALID_QUERY', 'Log records require a stable non-empty id')
        }
        if (typeof log.timestamp !== 'string') {
            throw new InsightError('INVALID_QUERY', 'Log records require a timestamp')
        }
        if (log.severity !== undefined && !logSeverities.has(log.severity)) {
            throw new InsightError(
                'INVALID_QUERY',
                `Unsupported log severity: ${String(log.severity)}`,
            )
        }
        return {
            ...log,
            ...(typeof log.observedTimestamp === 'string'
                ? {
                      observedTimestamp: normalizeTimestamp(
                          log.observedTimestamp,
                          'Log observed time',
                      ),
                  }
                : {}),
            timestamp: normalizeTimestamp(log.timestamp, 'Log timestamp'),
        } as LogRecord
    })
}

const requireLogData = (value: unknown): LogData => {
    if (!isRecord(value) || !Array.isArray(value.logs)) {
        throw new InsightError('INVALID_QUERY', 'Log adapter returned invalid data')
    }
    return { logs: normalizeLogs(value.logs as readonly LogRecord[]) }
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
