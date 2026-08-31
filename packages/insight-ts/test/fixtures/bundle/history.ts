import { createHistory } from 'insight-ts/history'

Object.assign(globalThis, {
    __insightBundleFixture: createHistory({
        repository: {
            coverage: async () => [],
            read: async () => [],
            write: async () => {},
        },
        sources: ['app.metrics'],
    }),
})
