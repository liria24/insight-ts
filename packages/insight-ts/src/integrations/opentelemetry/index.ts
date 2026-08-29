import { context, isSpanContextValid, SpanStatusCode, trace, type Tracer } from '@opentelemetry/api'

import type { Instrumentation } from '../../core/types.ts'

export interface OpenTelemetryInstrumentationOptions {
    name?: string
    tracer?: Tracer
    version?: string
}

export const createOpenTelemetryInstrumentation = (
    options: OpenTelemetryInstrumentationOptions = {},
): Instrumentation => {
    const tracer = options.tracer ?? trace.getTracer(options.name ?? 'insight-ts', options.version)
    return {
        activeTraceContext() {
            const spanContext = trace.getSpan(context.active())?.spanContext()
            return spanContext && isSpanContextValid(spanContext)
                ? { spanId: spanContext.spanId, traceId: spanContext.traceId }
                : undefined
        },
        run(name, attributes, operation) {
            return tracer.startActiveSpan(name, { attributes }, async (span) => {
                try {
                    return await operation({
                        recordException(error) {
                            span.recordException(toError(error))
                        },
                        setAttribute(attribute, value) {
                            span.setAttribute(attribute, value)
                        },
                    })
                } catch (error) {
                    span.recordException(toError(error))
                    span.setStatus({ code: SpanStatusCode.ERROR })
                    throw error
                } finally {
                    span.end()
                }
            })
        },
    }
}

const toError = (value: unknown): Error =>
    value instanceof Error ? value : new Error('Non-Error exception', { cause: value })
