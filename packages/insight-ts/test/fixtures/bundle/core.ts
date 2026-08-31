import { createInsight } from 'insight-ts'
import { defineProvider, defineSource } from 'insight-ts/provider'

const source = defineSource({
    execute: ({ value }: { value: number }) => ({ data: value }),
    key: ({ value }: { value: number }) => String(value),
    normalize: ({ value }: { value: number }) => ({ value }),
})

const core = createInsight({
    providers: [defineProvider({ id: 'app', sources: { value: source } })] as const,
})

Object.assign(globalThis, { __insightBundleFixture: core })
