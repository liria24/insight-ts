/* eslint-disable no-await-in-loop -- conformance verifies ordered writes and cursor traversal */

import { describe, expect, it } from 'vitest'

import type { HistoryRepository, HistorySegment, HistoryTarget } from '../../src/history/index.ts'
import type { TimeRange } from '../../src/metrics/index.ts'

type RepositoryFactory = () => HistoryRepository | Promise<HistoryRepository>

const firstRange = {
    from: '2026-08-01T00:00:00.000Z',
    to: '2026-08-02T00:00:00.000Z',
}
const secondRange = {
    from: firstRange.to,
    to: '2026-08-03T00:00:00.000Z',
}
const target = { adapter: 'app.logs', capability: 'logs', scope: 'production' }

export const historyRepositoryConformance = (name: string, create: RepositoryFactory): void => {
    describe(`${name} HistoryRepository conformance`, () => {
        it('isolates ranges, Scopes, capabilities, and adapters', async () => {
            const repository = await create()
            const targets = [
                target,
                { ...target, scope: 'staging' },
                { ...target, capability: 'traces' },
                { ...target, adapter: 'other.logs' },
            ]
            for (const [index, selected] of targets.entries()) {
                await repository.replace({ ...selected, range: firstRange }, [
                    segment(selected, firstRange, `target-${index}`, `0${index}`),
                ])
            }
            await repository.replace({ ...target, range: secondRange }, [
                segment(target, secondRange, 'second-range', '10'),
            ])

            await expect(
                repository.read({ ...target, limit: 10, range: firstRange }),
            ).resolves.toMatchObject({ segments: [{ id: 'target-0' }] })
            await expect(
                repository.read({ ...target, limit: 10, range: secondRange }),
            ).resolves.toMatchObject({ segments: [{ id: 'second-range' }] })
            for (const [index, selected] of targets.slice(1).entries()) {
                await expect(
                    repository.read({ ...selected, limit: 10, range: firstRange }),
                ).resolves.toMatchObject({ segments: [{ id: `target-${index + 1}` }] })
            }
        })

        it('replaces idempotently, paginates stably, and deletes only the requested range', async () => {
            const repository = await create()
            const values = [
                segment(target, firstRange, 'one', '1'),
                segment(target, firstRange, 'three', '3'),
                segment(target, firstRange, 'two', '2'),
            ]
            await repository.replace({ ...target, range: firstRange }, values)
            await repository.replace({ ...target, range: firstRange }, values)
            await repository.replace({ ...target, range: secondRange }, [
                segment(target, secondRange, 'retained', '4'),
            ])

            const first = await repository.read({ ...target, limit: 1, range: firstRange })
            const repeated = await repository.read({ ...target, limit: 1, range: firstRange })
            expect(repeated).toEqual(first)
            const ids = first.segments.map(({ id }) => id)
            let cursor = first.next
            while (cursor) {
                const page = await repository.read({
                    ...target,
                    cursor,
                    limit: 1,
                    range: firstRange,
                })
                ids.push(...page.segments.map(({ id }) => id))
                cursor = page.next
            }
            expect(ids).toEqual(['three', 'two', 'one'])
            await expect(
                repository.coverage({ ...target, range: firstRange }),
            ).resolves.toHaveLength(1)

            await repository.delete({ ...target, range: firstRange })
            await expect(
                repository.read({ ...target, limit: 10, range: firstRange }),
            ).resolves.toEqual({ segments: [] })
            await expect(
                repository.read({ ...target, limit: 10, range: secondRange }),
            ).resolves.toMatchObject({ segments: [{ id: 'retained' }] })
        })

        it('rejects invalid cursors', async () => {
            const repository = await create()
            await expect(
                repository.read({ ...target, cursor: 'invalid', limit: 1, range: firstRange }),
            ).rejects.toThrow(/invalid cursor/i)
        })
    })
}

const segment = (
    selected: HistoryTarget,
    range: TimeRange,
    id: string,
    sortKey: string,
): HistorySegment => ({
    ...selected,
    data: { id },
    fidelity: { preservation: 'full', transformations: [] },
    id,
    observedAt: range.to,
    range,
    schemaVersion: 2,
    sortKey,
})
