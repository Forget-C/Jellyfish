import assert from 'node:assert/strict'
import test from 'node:test'
import { readFile } from 'node:fs/promises'
import ts from 'typescript'
const compile = async name => ts.transpileModule(await readFile(new URL(`../src/pages/aiStudio/directing/${name}.ts`, import.meta.url), 'utf8'), { compilerOptions: { target: ts.ScriptTarget.ES2020, module: ts.ModuleKind.ES2020 } }).outputText
const data = source => `data:text/javascript;base64,${Buffer.from(source).toString('base64')}`
const graphLayoutUrl = data(await compile('graphLayout'))
const layoutUrl = data((await compile('directorLayout')).replaceAll("'./graphLayout'", JSON.stringify(graphLayoutUrl)))
const { arrangeDirector, intersects, migrateLegacyOverviewPositions, upgradeOverviewPositions, readDirectorView } = await import(layoutUrl)
const { pruneGraphView: pruneDirectorView } = await import(graphLayoutUrl)
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
test('shot entries surround the source without a group, while outer zones and retained positions stay clear', () => {
  const grouped = [{ id: '原文依据' }, ...'abcdefgh'.split('').map(id => ({ id: `shot:${id}`, group: 'scene-entry' })),
    { id: 'beat:x', group: 'scene-shared' }, { id: 'space', group: 'scene-global' }, { id: 'event:e', group: 'scene-unlinked' }]
  const dimensions = Object.fromEntries(grouped.map(node => [node.id, { width: 360, height: 240 }]))
  const placed = arrangeDirector(grouped, dimensions, 1440, '原文依据')
  assert.ok(placed.space.y < placed['原文依据'].y)
  assert.ok(placed['beat:x'].x < placed['原文依据'].x)
  assert.ok(placed['shot:a'].x > placed['原文依据'].x)
  assert.ok(placed['shot:c'].y > placed['原文依据'].y)
  assert.ok(placed['shot:e'].x < placed['原文依据'].x)
  assert.ok(placed['shot:g'].y < placed['原文依据'].y)
  assert.ok(placed.space.y + dimensions.space.height < placed['shot:g'].y)
  assert.ok(placed['beat:x'].x + dimensions['beat:x'].width < placed['shot:e'].x)
  assert.ok(placed['event:e'].y > placed['原文依据'].y)
  grouped.forEach((a, i) => grouped.slice(i + 1).forEach(b => assert.ok(!intersects({ ...placed[a.id], ...dimensions[a.id] }, { ...placed[b.id], ...dimensions[b.id] }), `${a.id} overlaps ${b.id}`)))
  const narrow = arrangeDirector(grouped, dimensions, 390, '原文依据')
  assert.deepEqual(new Set(Object.values(narrow).map(point => point.x)), new Set([0]))
  assert.equal(Math.min(...Object.values(narrow).map(point => point.y)), narrow['原文依据'].y)
  assert.ok(narrow.space.y < narrow['shot:a'].y && narrow['shot:h'].y < narrow['beat:x'].y && narrow['beat:x'].y < narrow['event:e'].y)
  const dense = [...grouped, ...Array.from({ length: 8 }, (_, index) => ({ id: `shot:extra-${index}`, group: 'scene-entry' })),
    ...Array.from({ length: 5 }, (_, index) => ({ id: `event:extra-${index}`, group: 'scene-unlinked' }))]
  const denseSizes = Object.fromEntries(dense.map(node => [node.id, { width: 360, height: 240 }]))
  const densePositions = arrangeDirector(dense, denseSizes, 1440, '原文依据')
  dense.forEach((a, i) => dense.slice(i + 1).forEach(b => assert.ok(!intersects({ ...densePositions[a.id], ...denseSizes[a.id] }, { ...densePositions[b.id], ...denseSizes[b.id] }), `${a.id} overlaps ${b.id}`)))
  assert.ok(densePositions['shot:extra-0'].x > placed['shot:a'].x)
  const retained = { ...placed, 'shot:a': { x: 2400, y: 800 } }
  const withManual = arrangeDirector(grouped, dimensions, 1440, '原文依据', retained)
  assert.deepEqual(withManual['shot:a'], retained['shot:a'])
})
test('legacy saved auto placement migrates to the source ring while manual shot positions remain', () => {
  const grouped = [{ id: '原文依据' }, ...'abcdefgh'.split('').map(id => ({ id: `shot:${id}`, group: 'scene-entry' })),
    { id: 'beat:x', group: 'scene-shared' }, { id: 'space', group: 'scene-global' }]
  const dimensions = Object.fromEntries(grouped.map(node => [node.id, { width: 360, height: node.id === '原文依据' ? 240 : 276 }]))
  const old = { '原文依据': { x: 0, y: 0 }, 'shot:a': { x: 424, y: 0 }, 'shot:b': { x: 848, y: 0 },
    'shot:c': { x: 2400, y: 800 }, 'shot:d': { x: 424, y: 340 }, 'shot:e': { x: 848, y: 340 }, 'shot:f': { x: 1272, y: 340 },
    'shot:g': { x: 424, y: 680 }, 'shot:h': { x: 848, y: 680 }, 'beat:x': { x: -424, y: 0 }, space: { x: 0, y: -436 } }
  const migrated = migrateLegacyOverviewPositions(grouped, dimensions, old)
  assert.deepEqual(migrated['shot:c'], old['shot:c'])
  assert.equal(migrated['shot:b'], undefined)
  assert.equal(migrated['beat:x'], undefined)
  assert.equal(migrated.space, undefined)
  const placed = arrangeDirector(grouped, dimensions, 1440, '原文依据', migrated)
  assert.ok(placed['shot:b'].y > placed['原文依据'].y)
  assert.ok(placed['beat:x'].x < old['beat:x'].x)
  assert.ok(placed.space.y < old.space.y)
  assert.deepEqual(placed['shot:c'], old['shot:c'])
})
test('a saved vertical overview is rebuilt once and only recorded manual positions survive', () => {
  const grouped = [{ id: '原文依据' }, { id: 'shot:a', group: 'scene-entry' }, { id: 'shot:b', group: 'scene-entry' }]
  const dimensions = Object.fromEntries(grouped.map(node => [node.id, { width: 360, height: 276 }]))
  const view = { layoutVersion: 2, transform: { x: 0, y: 0, scale: 1 }, sizes: dimensions,
    positions: { '原文依据': { x: 0, y: 336 }, 'shot:a': { x: 0, y: 1604 }, 'shot:b': { x: 2400, y: 800 } }, manuallyPlaced: ['shot:b'] }
  assert.deepEqual(upgradeOverviewPositions(view, grouped, dimensions), { 'shot:b': view.positions['shot:b'] })
  const placed = arrangeDirector(grouped, dimensions, 1440, '原文依据', upgradeOverviewPositions(view, grouped, dimensions))
  assert.deepEqual(placed['原文依据'], { x: 0, y: 0 })
  assert.ok(placed['shot:a'].x > placed['原文依据'].x)
  assert.deepEqual(placed['shot:b'], view.positions['shot:b'])
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
