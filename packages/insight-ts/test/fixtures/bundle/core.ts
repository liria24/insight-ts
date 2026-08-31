import { createInsight, defineProvider, defineSource } from 'insight-ts'

const source = defineSource({
    execute: ({ value }: { value: number }) => ({ data: value }),
    key: ({ value }: { value: number }) => String(value),
    normalize: ({ value }: { value: number }) => ({ value }),
})

const core = createInsight({
    providers: [defineProvider({ id: 'app', sources: { value: source } })],
})

Object.assign(globalThis, { __insightBundleFixture: core })
