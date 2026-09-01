import { createHistory } from 'insight-ts/history'

const repository = {
    coverage: async () => [],
    delete: async () => {},
    read: async () => {
        const segments: never[] = []
        return Object.assign(segments, { segments })
    },
    replace: async () => {},
    write: async () => {},
}
const historyOptions = { repository, sources: ['app.metrics'] }

Object.assign(globalThis, {
    __insightBundleFixture: createHistory(historyOptions),
})
