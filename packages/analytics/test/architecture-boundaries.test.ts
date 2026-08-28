import { readdir, readFile } from 'node:fs/promises'
import { dirname, join, relative, resolve } from 'node:path'

import { describe, expect, it } from 'vitest'

const sourceRoot = resolve(import.meta.dirname, '..', 'src')

describe('architecture import boundaries', () => {
    it('keeps Core independent from adapters, integrations, and frameworks', async () => {
        const violations = await importViolations(join(sourceRoot, 'core'), (specifier, file) => {
            const target = localTarget(specifier, file)
            if (target?.includes('/adapters/') || target?.includes('/integrations/')) return true
            return /^(?:h3|nitro|nitropack|nuxt|vue)(?:\/|$)/.test(specifier)
        })

        expect(violations).toEqual([])
    })

    it('keeps adapters independent from integrations and framework runtimes', async () => {
        const violations = await importViolations(
            join(sourceRoot, 'adapters'),
            (specifier, file) => {
                if (localTarget(specifier, file)?.includes('/integrations/')) return true
                return /^(?:h3|nitro|nitropack|nuxt|vue)(?:\/|$)/.test(specifier)
            },
        )

        expect(violations).toEqual([])
    })

    it('keeps Presentation dependent only on Core report contracts', async () => {
        const file = join(sourceRoot, 'presentation.ts')
        const source = await readFile(file, 'utf8')
        const violations = importSpecifiers(source).filter((specifier) => {
            const target = localTarget(specifier, file)
            return target === undefined || !target.includes('/core/')
        })

        expect(violations).toEqual([])
    })
})

async function importViolations(
    directory: string,
    blocked: (specifier: string, file: string) => boolean,
): Promise<string[]> {
    const violations: string[] = []
    const files = await sourceFiles(directory)
    const sources = await Promise.all(files.map((file) => readFile(file, 'utf8')))
    for (const [index, file] of files.entries()) {
        for (const specifier of importSpecifiers(sources[index] ?? '')) {
            if (blocked(specifier, file)) {
                violations.push(`${relative(sourceRoot, file)} -> ${specifier}`)
            }
        }
    }
    return violations
}

async function sourceFiles(directory: string): Promise<string[]> {
    const entries = await readdir(directory, { withFileTypes: true })
    const files = await Promise.all(
        entries.map((entry) => {
            const path = join(directory, entry.name)
            return entry.isDirectory() ? sourceFiles(path) : Promise.resolve([path])
        }),
    )
    return files.flat().filter((file) => file.endsWith('.ts'))
}

function importSpecifiers(source: string): string[] {
    return [...source.matchAll(/(?:from\s*|import\s*\()\s*['"]([^'"]+)['"]/g)].map(
        (match) => match[1] ?? '',
    )
}

function localTarget(specifier: string, file: string): string | undefined {
    if (!specifier.startsWith('.')) return undefined
    return resolve(dirname(file), specifier).replaceAll('\\', '/')
}
