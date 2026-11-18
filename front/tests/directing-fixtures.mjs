import { readFile } from 'node:fs/promises'
import ts from 'typescript'

// Use the project's TypeScript compiler; these modules contain only pure logic and type imports.
export async function loadSource(name) {
  const source = await readFile(new URL(`../src/pages/aiStudio/directing/${name}.ts`, import.meta.url), 'utf8')
  const { outputText } = ts.transpileModule(source, { compilerOptions: { target: ts.ScriptTarget.ES2020, module: ts.ModuleKind.ES2020 } })
  return import(`data:text/javascript;base64,${Buffer.from(outputText).toString('base64')}`)
}

export function makeSequence(title = 'UX1 隔离验收场次') {
  return {
    id: 's1', project_id: 'p1', chapter_id: 'ch1', title, position: 0, version: 1,
    source: { kind: 'human', reference: 'sample', version: '1' },
    source_text: '他递出旧信，她认出了他。', span: null, source_changed: false, is_current: true,
  }
}
