import { existsSync, readFileSync } from 'node:fs'
import { readFile } from 'node:fs/promises'
import { resolve } from 'node:path'

import * as compiler35 from '@vue/compiler-sfc'
import { describe, expect, it } from 'vitest'
import * as compiler36 from 'vue-compiler-36'

const components = [
    'InsightStat.vue',
    'InsightLineChart.vue',
    'InsightAreaChart.vue',
    'InsightBreakdownTable.vue',
] as const
const fs = { fileExists: existsSync, readFile: (path: string) => readFileSync(path, 'utf8') }

describe('Vue compiler compatibility', () => {
    it.each(components)('compiles %s with Vue 3.5 VDOM and Vue 3.6 Vapor', async (name) => {
        const filename = resolve(
            import.meta.dirname,
            '..',
            'src',
            'integrations',
            'vue',
            'ui',
            'components',
            name,
        )
        const source = await readFile(filename, 'utf8')
        expect(compile35(source, filename)).toEqual([])
        expect(compile36(source, filename)).toEqual([])
    })
})

function compile35(source: string, filename: string): readonly unknown[] {
    const { descriptor, errors } = compiler35.parse(source, { filename })
    if (errors.length > 0 || !descriptor.template) return errors
    const script = compiler35.compileScript(descriptor, { fs, id: filename })
    return compiler35.compileTemplate({
        compilerOptions: { bindingMetadata: script.bindings ?? {} },
        filename,
        id: filename,
        source: descriptor.template.content,
    }).errors
}

function compile36(source: string, filename: string): readonly unknown[] {
    const { descriptor, errors } = compiler36.parse(source, { filename })
    if (errors.length > 0 || !descriptor.template) return errors
    const script = compiler36.compileScript(descriptor, { fs, id: filename })
    return compiler36.compileTemplate({
        compilerOptions: { bindingMetadata: script.bindings ?? {} },
        filename,
        id: filename,
        source: descriptor.template.content,
        vapor: true,
    }).errors
}
