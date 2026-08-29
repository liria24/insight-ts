/* eslint-disable typescript/no-unsafe-type-assertion, typescript/unbound-method -- OTel interfaces are structurally mocked at the adapter boundary */

import type { Span, Tracer } from '@opentelemetry/api'
import { describe, expect, it, vi } from 'vitest'

import { createOpenTelemetryInstrumentation } from '../src/integrations/opentelemetry/index.ts'

describe('OpenTelemetry instrumentation adapter', () => {
    it('uses a host-owned Tracer and closes spans on success', async () => {
        const span = fakeSpan()
        const startActiveSpan = vi.fn<
            (name: string, options: unknown, operation: (span: Span) => unknown) => unknown
        >((_name, _options, operation) => operation(span))
        const instrumentation = createOpenTelemetryInstrumentation({
            tracer: { startActiveSpan } as unknown as Tracer,
        })

        await expect(
            instrumentation.run('insight.query', { 'insight.query.count': 2 }, (active) => {
                active.setAttribute('insight.provider', 'demo')
                return 42
            }),
        ).resolves.toBe(42)
        expect(startActiveSpan).toHaveBeenCalledWith(
            'insight.query',
            { attributes: { 'insight.query.count': 2 } },
            expect.any(Function),
        )
        expect(span.setAttribute).toHaveBeenCalledWith('insight.provider', 'demo')
        expect(span.end).toHaveBeenCalledOnce()
    })

    it('records errors and still closes the span', async () => {
        const span = fakeSpan()
        const tracer = {
            startActiveSpan: vi.fn<
                (name: string, options: unknown, operation: (span: Span) => unknown) => unknown
            >((_name, _options, operation) => operation(span)),
        } as unknown as Tracer
        const instrumentation = createOpenTelemetryInstrumentation({ tracer })
        const error = new Error('failed')

        await expect(
            instrumentation.run('insight.provider.execute', {}, () => {
                throw error
            }),
        ).rejects.toBe(error)
        expect(span.recordException).toHaveBeenCalledWith(error)
        expect(span.setStatus).toHaveBeenCalledWith(expect.objectContaining({ code: 2 }))
        expect(span.end).toHaveBeenCalledOnce()
    })
})

function fakeSpan(): Span {
    return {
        end: vi.fn<Span['end']>(),
        recordException: vi.fn<Span['recordException']>(),
        setAttribute: vi.fn<Span['setAttribute']>(),
        setStatus: vi.fn<Span['setStatus']>(),
    } as unknown as Span
}
