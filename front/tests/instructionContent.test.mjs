import assert from 'node:assert/strict'
import test from 'node:test'
import { readFile } from 'node:fs/promises'
import ts from 'typescript'

async function moduleUrl(name) {
  const source = await readFile(new URL(`../src/pages/aiStudio/directing/${name}.ts`, import.meta.url), 'utf8')
  let { outputText } = ts.transpileModule(source, { compilerOptions: { target: ts.ScriptTarget.ES2020, module: ts.ModuleKind.ES2020 } })
  for (const match of [...outputText.matchAll(/from ['"]\.\/([^'"]+)['"]/g)]) outputText = outputText.replace(match[0], `from '${await moduleUrl(match[1])}'`)
  return `data:text/javascript;base64,${Buffer.from(outputText).toString('base64')}`
}
const { instructionBlocks, relatedInstructionPath, blockPaths, blockChanges, scopeForBlock, blockFindings, instructionGraphBlocks } = await import(await moduleUrl('instructionContent'))
const format_version = 'jellyfish-scene-v4'

test('compiled blocks preserve every byte and distinguish background from execution', () => {
  const text = '【场次试拍 v4】\n时长 6 秒，画幅 16:9。\n声音安排：对白和声音待后期处理\n【场次背景】不要执行背景动作\n共同背景\n【本次执行动作】\n只执行以下范围\n镜头 1 [s1]：停步\nmovement_path：推进\n未知文字\n'
  const decisions = [{ section_path: '/cinematography/0/movement_path', text_excerpt: 'movement_path：推进' }]
  const blocks = instructionBlocks({ text, format_version, decisions }, 'p1')
  assert.equal(blocks.map(block => block.text).join(''), text)
  for (const block of blocks) assert.equal(text.slice(block.start, block.end), block.text)
  assert.ok(blocks.some(block => block.kind === 'action' && block.section === 'execution'))
  assert.ok(blocks.some(block => block.kind === 'space' && block.section === 'background'))
  assert.ok(blocks.some(block => block.kind === 'camera'))
})

test('repeated overlapping excerpts retain all source decisions and real positions', () => {
  const text = '【本次执行动作】\n重复正文\n重复正文\n'
  const decisions = [{ section_path: '/cinematography/0/composition', text_excerpt: '重复正文' }, { section_path: '/cinematography/0/movement_path', text_excerpt: '重复' }]
  const blocks = instructionBlocks({ text, format_version, decisions }, 'p1')
  assert.deepEqual(blocks.find(block => block.kind === 'camera').decisions, [0, 1])
  assert.deepEqual(blockPaths(blocks.find(block => block.kind === 'camera'), decisions), decisions.map(row => row.section_path))
  assert.equal(blocks.map(block => block.text).join(''), text)
})

test('path boundaries, target ownership, allowed scope and findings match actual data', () => {
  assert.equal(relatedInstructionPath('/cinematography/1', '/cinematography/10'), false)
  const decisions = [{ section_path: '/cinematography/0/movement_path', text_excerpt: '推进' }]
  const block = instructionBlocks({ text: '推进', format_version, decisions }, 'p')[0]
  const fields = [{ target: 'design', path: '/cinematography/0/movement_path', value: '推进' }, { target: 'unit', path: '/cinematography/0/movement_path' }, { target: 'design', path: '/cinematography/1/movement_path' }]
  assert.deepEqual(scopeForBlock(block, decisions, fields), [{ target: 'design', path: '/cinematography/0/movement_path' }])
  assert.equal(blockChanges(block, decisions, fields).length, 1)
  assert.equal(blockFindings(block, decisions, { affected_paths: ['/cinematography/0'] }), true)
  assert.equal(blockFindings(block, decisions, { affected_paths: ['/cinematography/10'] }), false)
})

test('legacy and unknown text remain readable without a fabricated source or local scope', () => {
  const text = '原指令全文\n\n未识别内容'
  const blocks = instructionBlocks({ text, format_version: 'legacy', decisions: [] }, 'old')
  assert.equal(blocks[0].text, text)
  assert.equal(blocks[0].section, 'other')
  assert.deepEqual(scopeForBlock(blocks[0], [], [{ target: 'unit', path: '/duration_ms' }]), [])
  assert.deepEqual(instructionBlocks({ text: '', format_version, decisions: [] }, 'empty'), [])
})

const { instructionRelations } = await import(await moduleUrl('instructionRelations'))

test('relations require frozen excerpts, check occurrence and explicit problem identity', () => {
  const prompt = { text: '推进\n推进', format_version, decisions: [{ section_path: '/cinematography/0/movement_path', disposition: 'text', text_excerpt: '推进', explanation: '固定摄影' }] }
  const block = instructionBlocks(prompt, 'p')[0]
  const key = JSON.stringify(['o', 'cinematography', 0])
  const packet = { occurrences: [{ id: 'o', prompt_revision_id: 'p' }], rows: [{ occurrence_id: 'o', role: 'cinematography', verdict: 'revise', findings: [{ affected_paths: ['/cinematography/0'], observation: '主体出画' }] }] }
  const candidate = { candidate_identity: 'hash', changes: [{ target: 'design', path: '/cinematography/0/movement_path', before: '推进', after: '固定', reason: '按要求', problem_keys: [key] }] }
  const graph = instructionRelations({ prompt, promptId: 'p', block, packet, reviewSource: 'review:r1', candidateReviewSource: 'review:r1', candidate, stale: false, instruction: '固定', scope: [{ target: 'design', path: '/cinematography/0/movement_path' }], frozenInstruction: '固定' })
  assert.ok(graph.edges.some(edge => edge.label === '写入正文'))
  assert.ok(graph.edges.some(edge => edge.label === '涉及此组内容'))
  assert.ok(graph.edges.some(edge => edge.label === '方案关联问题'))
  assert.ok(graph.edges.some(edge => edge.from === 'p:draft' && edge.label === '本次方案'))
  packet.occurrences[0].prompt_revision_id = 'different'
  assert.equal(instructionRelations({ prompt, promptId: 'p', block, packet, stale: false, instruction: '', scope: null }).nodes.some(node => node.kind === 'issue'), false)
  const unsupported = { ...prompt, decisions: [{ ...prompt.decisions[0], text_excerpt: '不存在的摘录' }] }
  assert.equal(instructionRelations({ prompt: unsupported, promptId: 'p', block, stale: false, instruction: '', scope: null }).edges.length, 0)
})

test('new draft cannot link to stale candidate; whole request does not fan out as a local target', () => {
  const prompt = { text: '推进', format_version, decisions: [{ section_path: '/cinematography/0/movement_path', disposition: 'text', text_excerpt: '推进', explanation: '' }] }
  const block = instructionBlocks(prompt, 'p')[0]
  const candidate = { candidate_identity: 'old', changes: [{ target: 'design', path: '/cinematography/0/movement_path', before: '推进', after: '固定', reason: '旧要求' }] }
  const graph = instructionRelations({ prompt, promptId: 'p', block, candidate, stale: true, instruction: '改为摇镜', scope: null, frozenInstruction: '固定' })
  assert.ok(graph.nodes.some(node => node.text === '固定' && node.kind === 'request'))
  assert.ok(graph.nodes.some(node => node.text === '改为摇镜' && node.kind === 'request'))
  assert.equal(graph.edges.some(edge => edge.from === 'p:draft'), false)
  assert.ok(graph.edges.some(edge => edge.from === 'old:request' && edge.label === '本次方案'))
})

test('reference-only and unexpressed decisions never create fake text edges or missing bindings', () => {
  const prompt = { text: '历史原文', format_version: 'legacy', decisions: [
    { section_path: '/participants/0', disposition: 'reference', reference_id: 'ref', explanation: '由参考表达' },
    { section_path: '/prompt/constraints', disposition: 'unexpressed', explanation: '未表达' }] }
  const block = instructionBlocks(prompt, 'p')[0]
  const args = { prompt, promptId: 'p', block, stale: false, instruction: '', scope: null }
  assert.equal(instructionRelations(args).edges.length, 0)
  const graph = instructionRelations({ ...args, referenceIds: ['ref'] })
  assert.deepEqual(graph.edges.map(edge => edge.label), ['由参考表达'])
  assert.ok(graph.nodes.some(node => node.kind === 'source' && node.path === '/prompt/constraints'))
})

test('multiple shot headers keep distinct ordered camera cards and scopes', () => {
  const text = '【本次执行动作】\n【cinematography[1]: shot_id=s1】\nmovement_path：固定\n【cinematography[2]: shot_id=s2】\nmovement_path：推进'
  const decisions = [{ section_path: '/cinematography/0/movement_path', text_excerpt: 'movement_path：固定' }, { section_path: '/cinematography/1/movement_path', text_excerpt: 'movement_path：推进' }]
  const blocks = instructionBlocks({ text, format_version, decisions }, 'multi')
  const cameras = blocks.filter(block => block.kind === 'camera')
  assert.equal(cameras.length, 2)
  assert.deepEqual(cameras.map(block => blockPaths(block, decisions)), decisions.map(row => [row.section_path]))
  assert.equal(blocks.map(block => block.text).join(''), text)
})


test('v4 unmapped decisions remain selectable without invented text or endpoint edges', () => {
  const prompt = { text: '【本次执行动作】\n停步', format_version, decisions: [{ section_path: '/prompt/constraints', disposition: 'unexpressed', explanation: '没有表达' }, { section_path: '/participants/0', disposition: 'reference', reference_id: 'ref', explanation: '固定参考' }] }
  const blocks = instructionBlocks(prompt, 'p')
  const options = instructionGraphBlocks(prompt, 'p', blocks)
  assert.equal(options.length, blocks.length + 2)
  const block = options.find(row => row.title === '未写入正文')
  const graph = instructionRelations({ prompt, promptId: 'p', block, stale: false, instruction: '', scope: null })
  assert.equal(graph.nodes.some(node => node.kind === 'text'), false)
  assert.equal(graph.nodes.filter(node => node.kind === 'source').length, 1)
  assert.equal(graph.edges.length, 0)
  assert.equal(blocks.map(row => row.text).join(''), prompt.text)
})

test('fixed unit input requires exact compiler text and remains separate from design paths', () => {
  const prompt = { text: '【场次试拍 v4】\n时长 5 秒，画幅 16:9。', format_version, decisions: [] }
  const block = instructionBlocks(prompt, 'p')[0]
  const args = { prompt, promptId: 'p', block, stale: false, instruction: '', scope: null }
  const unit = { duration_ms: 5000, ratio: '16:9' }
  const graph = instructionRelations({ ...args, unit })
  assert.deepEqual(graph.nodes.filter(node => node.target === 'unit').map(node => node.path), ['/duration_ms', '/ratio'])
  assert.deepEqual(graph.edges.map(edge => edge.label), ['固定单元参数', '固定单元参数'])
  assert.equal(instructionRelations({ ...args, unit: { ...unit, duration_ms: 6000 } }).edges.length, 0)
})

test('candidate issue links never cross review sources even with identical occurrence keys', () => {
  const prompt = { text: '推进', format_version, decisions: [{ section_path: '/cinematography/0/movement_path', disposition: 'text', text_excerpt: '推进', explanation: '' }] }
  const key = JSON.stringify(['o', 'cinematography', 0])
  const packet = { occurrences: [{ id: 'o', prompt_revision_id: 'p', local_number: 1, shot_id: 's' }], rows: [{ occurrence_id: 'o', role: 'cinematography', verdict: 'revise', findings: [{ affected_paths: ['/cinematography/0'], observation: '出画' }] }] }
  const candidate = { candidate_identity: 'old', changes: [{ target: 'design', path: '/cinematography/0/movement_path', before: '推进', after: '固定', reason: '修改', problem_keys: [key] }] }
  const args = { prompt, promptId: 'p', block: instructionBlocks(prompt, 'p')[0], packet, candidate, stale: true, instruction: '', scope: null, reviewSource: 'review:new', candidateReviewSource: 'review:old' }
  assert.equal(instructionRelations(args).edges.some(edge => edge.label === '方案关联问题'), false)
  assert.equal(instructionRelations({ ...args, candidateReviewSource: 'review:new' }).edges.some(edge => edge.label === '方案关联问题'), true)
})
