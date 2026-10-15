import assert from 'node:assert/strict'
import test from 'node:test'
import { readFile } from 'node:fs/promises'
import ts from 'typescript'
const compile = async name => ts.transpileModule(await readFile(new URL(`../src/pages/aiStudio/directing/${name}.ts`, import.meta.url), 'utf8'), { compilerOptions: { target: ts.ScriptTarget.ES2020, module: ts.ModuleKind.ES2020 } }).outputText
const data = source => `data:text/javascript;base64,${Buffer.from(source).toString('base64')}`
const layoutUrl = data(await compile('directorLayout'))
const { arrangeDirector, intersects, readDirectorView, pruneDirectorView } = await import(layoutUrl)
const { directorRelationCategory } = await import(data(await compile('directorRelations')))
const nodes = ['原文依据', '全场共享', 'shot:one', 'camera:one', 'performance:one', ...Array.from({ length: 5 }, (_, i) => `criterion:${i}`)].map(id => ({ id }))
const sizes = Object.fromEntries(nodes.map((node, i) => [node.id, { width: 360, height: 200 + i % 3 * 60 }]))
const boxes = positions => nodes.map(node => ({ id: node.id, ...positions[node.id], ...sizes[node.id] }))

test('five criteria use 3+2 / 2+2+1 / one column without overlapping variable-height cards', () => {
  for (const [viewport, columns, rows] of [[1600, 3, 2], [1100, 2, 3], [390, 1, 5]]) {
    const positions = arrangeDirector(nodes, sizes, viewport, 'shot:one')
    const criteria = Object.entries(positions).filter(([id]) => id.startsWith('criterion:')).map(([, point]) => point)
    assert.equal(new Set(criteria.map(point => point.x)).size, columns)
    assert.equal(new Set(criteria.map(point => point.y)).size, rows)
    const all = boxes(positions)
    all.forEach((a, i) => all.slice(i + 1).forEach(b => assert.ok(!intersects(a, b, 24), `${a.id} overlaps ${b.id}`)))
    assert.ok(positions['全场共享'].y < positions['shot:one'].y)
  }
})
test('new cards fill free slots without moving retained cards, even after manual movement', () => {
  const original = arrangeDirector(nodes.slice(0, -1), sizes, 1100, 'shot:one')
  original['criterion:1'] = { x: 1500, y: 700 }
  const result = arrangeDirector(nodes, sizes, 1100, 'shot:one', original)
  for (const [id, point] of Object.entries(original)) assert.deepEqual(result[id], point)
  const added = { ...result['criterion:4'], ...sizes['criterion:4'] }
  for (const [id, point] of Object.entries(original)) assert.ok(!intersects(added, { ...point, ...sizes[id] }, 24))
})
test('all drawn relation labels keep their category, including compressed paths', () => {
  const groups = {
    design: ['摄影设计', '调度依据', '节拍表演', '连续性变化', '覆盖节拍 → 节拍表演'],
    evidence: ['参与对象', '覆盖节拍', '关联事件', '调度人物', '位置锚点', '变化事件', '表演人物', '对白依据', '共享场所'],
    criterion: ['验收依据'], constraint: ['全场约束'],
  }
  for (const [category, labels] of Object.entries(groups)) for (const label of labels) assert.equal(directorRelationCategory(label), category)
})
test('corrupt storage is ignored and deletion preserves hidden-but-valid positions', () => {
  const view = { schema: 1, transform: { x: -200, y: 30, scale: 1 }, positions: { live: { x: 0, y: 1 }, hidden: { x: 4, y: 8 }, deleted: { x: 2, y: 3 } }, sizes: { live: { width: 360, height: 300 } } }
  assert.ok(readDirectorView(JSON.stringify(view)))
  for (const raw of ['invalid', 'null', '[]', JSON.stringify({ ...view, transform: { scale: 0 } }), JSON.stringify({ ...view, sizes: [] }), JSON.stringify({ ...view, positions: { bad: { x: null, y: 0 } } })]) assert.equal(readDirectorView(raw), undefined)
  assert.deepEqual(Object.keys(pruneDirectorView(view, new Set(['live', 'hidden'])).positions), ['live', 'hidden'])
})
