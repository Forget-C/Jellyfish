import assert from 'node:assert/strict'
import test from 'node:test'
import { readFile } from 'node:fs/promises'
import ts from 'typescript'

async function moduleUrl(name) {
  const source = await readFile(new URL(`../src/pages/aiStudio/generationCanvas/${name}.ts`, import.meta.url), 'utf8')
  let { outputText } = ts.transpileModule(source, { compilerOptions: { target: ts.ScriptTarget.ES2020, module: ts.ModuleKind.ES2020 } })
  for (const match of [...outputText.matchAll(/from ['"]\.\/([^'"]+)['"]/g)]) outputText = outputText.replace(match[0], `from '${await moduleUrl(match[1])}'`)
  return `data:text/javascript;base64,${Buffer.from(outputText).toString('base64')}`
}
const { createCanvasOperations } = await import(await moduleUrl('canvasOperations'))
const { createGraphRules } = await import(await moduleUrl('graphRules'))
const port = (id, value_kind) => ({ id, value_kind, label: id })
const input = (id, value_kind) => ({ id, accepts: [value_kind], label: id })
const definition = (type, outputs = [], inputs = []) => ({ type, title: type, outputs, inputs })
const connection_policies = [
  ...['direction.guidance', 'direction.criterion'].flatMap(source_type => ['model.text', 'model.image', 'model.video'].map(target_type => ({ source_type, source_port: 'text', target_type, target_port: 'text', adoption_allowed: true, connect: 'adopt_design', cancel: 'remove_connection', disconnect: 'release' }))),
  { source_type: 'direction.criterion', source_port: 'criterion', target_type: 'direction.shot', target_port: 'acceptance_basis', adoption_allowed: true, connect: 'associate_acceptance', cancel: 'remove_connection', disconnect: 'release' },
  { source_type: 'direction.movement', source_port: 'text', target_type: 'direction.composition', target_port: 'text', adoption_allowed: true, connect: 'candidate', cancel: 'keep_connection', disconnect: 'confirm_frame' },
]
const rules = createGraphRules({ connection_policies, cards: [
  definition('direction.criterion', [port('criterion', 'criterion')]),
  definition('direction.shot', [], [input('acceptance_basis', 'criterion')]),
  definition('content.image', [port('image', 'image')]),
  definition('content.text', [port('text', 'text')]),
  definition('content.character', [port('text', 'text')]),
  definition('reference.character', [], [input('name', 'text'), input('image_source', 'image')]),
  definition('model.image', [port('image', 'image')], [input('image', 'image'), input('first_frame', 'image')]),
] })
const operations = createCanvasOperations(rules)
const source = { canvas_id: 'canvas', card_id: 'image', port_id: 'image', position: 0 }
const image = { id: 'image', type: 'content.image', file_id: 'file' }
const text = { id: 'text', type: 'content.text', text: '正文' }
const edge = { id: 'edge', source_card: 'image', source_port: 'image', target_card: 'model', target_port: 'image' }
const model = { id: 'model', type: 'model.image', input_bindings: [{ id: 'binding', source, input_port: 'image' }], prompt: { segments: [] } }
const document = overrides => ({ id: 'canvas', cards: [image, text, model], edges: [edge], input_order: { model: { image: ['edge'] } }, groups: [], ...overrides })

test('one adopted source rejects the entire deletion batch without changing the document', () => {
  const original = document()
  const before = structuredClone(original)
  const result = operations.remove(original, ['text', 'image'], new Set(), id => id)
  assert.equal(result.document, undefined)
  assert.equal(result.protection.cardId, 'model')
  assert.deepEqual(original, before)
})

test('updating a reference returns its field changes and both source connections together', () => {
  const character = { id: 'character', type: 'content.character', name: '阿青', text: '人物描述' }
  const reference = { id: 'reference', type: 'reference.character', name: '', image_binding: null }
  const original = document({ cards: [character, image, reference], edges: [], input_order: {} })
  const next = { ...reference, name: '阿青', name_binding: { ...source, card_id: 'character', port_id: 'text' }, image_binding: { file_id: 'file', source } }
  const result = operations.update(original, next)
  assert.equal(result.document.cards[2].name, '阿青')
  assert.deepEqual(result.document.edges.map(edge => [edge.source_card, edge.target_port]), [['character', 'name'], ['image', 'image_source']])
  assert.equal(result.document.input_order.reference.name.length, 1)
  assert.equal(result.document.input_order.reference.image_source.length, 1)
  assert.deepEqual(original.edges, [])
  assert.equal(original.cards[2].name, '')
  const renamed = operations.update(result.document, { ...character, name: '阿蓝' })
  assert.equal(renamed.document.cards[2].name, '阿蓝')
})

test('a rejected source connection does not partially apply the reference update', () => {
  const reference = { id: 'reference', type: 'reference.character', name: '原名称' }
  const character = { id: 'character', type: 'content.character', name: '新名称', text: '' }
  const original = document({ cards: [character, text, reference], edges: [], input_order: {} })
  const before = structuredClone(original)
  const result = operations.update(original, { ...reference, name: '新名称', name_binding: { ...source, card_id: 'character', port_id: 'text' }, image_binding: { source: { ...source, card_id: 'text', port_id: 'text' } } })
  assert.equal(result.document, undefined)
  assert.match(result.reason, /参考图仅支持图片内容卡/)
  assert.deepEqual(original, before)
})

test('candidate connection preserves adoption, ignores duplicates and orders only the receiving port', () => {
  const original = document({ edges: [], input_order: {}, cards: [image, { ...model, input_bindings: [] }] })
  const connected = operations.connect(original, edge).document
  assert.deepEqual(connected.input_order, { model: { image: ['edge'] } })
  assert.deepEqual(connected.cards[1].input_bindings, [])
  assert.equal(operations.connect(connected, { ...edge, id: 'duplicate' }).document, connected)
  const second = { ...edge, id: 'second', target_port: 'first_frame' }
  const paired = operations.connect(connected, second).document
  assert.deepEqual(paired.input_order, { model: { image: ['edge'], first_frame: ['second'] } })
  assert.deepEqual(original.edges, [])
})

test('disconnect protects the adopted purpose but permits an unused purpose from the same source', () => {
  const candidate = { ...edge, id: 'candidate', target_port: 'first_frame' }
  const original = document({ edges: [edge, candidate], input_order: { model: { image: ['edge'], first_frame: ['candidate'] } } })
  assert.match(operations.disconnect(original, edge).reason, /仍有输入被引用/)
  const result = operations.disconnect(original, candidate).document
  assert.deepEqual(result.edges, [edge])
  assert.deepEqual(result.input_order, { model: { image: ['edge'], first_frame: [] } })
  assert.deepEqual(result.cards[2].input_bindings, model.input_bindings)
})

test('deletion removes candidate edges, input order and group membership while preserving unrelated cards', () => {
  const original = document({ cards: [image, text, { ...model, input_bindings: [] }], groups: [{ id: 'group', kind: 'group', card_ids: ['image', 'text'] }] })
  const result = operations.remove(original, ['image'], new Set(), id => id).document
  assert.deepEqual(result.cards.map(card => card.id), ['text', 'model'])
  assert.deepEqual(result.edges, [])
  assert.deepEqual(result.input_order, { model: { image: [] } })
  assert.deepEqual(result.groups[0].card_ids, ['text'])
  assert.equal(original.cards[0].file_id, 'file')
  assert.deepEqual(original.groups[0].card_ids, ['image', 'text'])
})

test('deletion rechecks runtime and stack protection against the supplied current state', () => {
  const original = document({ cards: [image, text, { ...model, input_bindings: [] }] })
  assert.ok(operations.remove(original, ['image', 'text'], new Set(), id => id).document)
  assert.match(operations.remove(original, ['image', 'text'], new Set(['image']), id => id).reason, /正在运行/)
  const stacked = { ...original, groups: [{ id: 'stack', kind: 'stack', card_ids: ['model'] }] }
  assert.match(operations.remove(stacked, ['image', 'text'], new Set(), id => id).reason, /解除相关堆叠/)
  assert.match(operations.disconnect(stacked, edge).reason, /解除堆叠/)
})

test('legacy reference source cleanup preserves its fixed image and leaves valid documents unchanged', () => {
  const invalid = { ...edge, id: 'legacy', source_card: 'model', target_card: 'reference', target_port: 'image_source' }
  const reference = { id: 'reference', type: 'reference.character', name: '人物', image_binding: { file_id: 'retained-file', source: { ...source, card_id: 'model' } } }
  const original = document({ cards: [model, reference], edges: [invalid], input_order: { reference: { image_source: ['legacy'] } } })
  const result = operations.clean(original)
  assert.deepEqual(result.cards[1].image_binding, { file_id: 'retained-file', source: null })
  assert.deepEqual(result.edges, [])
  assert.deepEqual(result.input_order.reference.image_source, [])
  assert.equal(original.cards[1].image_binding.source.card_id, 'model')
  assert.equal(operations.clean(result), result)
})

test('copying incoming connections preserves explicit input order rather than edge array order', () => {
  const secondImage = { ...image, id: 'second-image' }
  const secondEdge = { ...edge, id: 'second-edge', source_card: secondImage.id }
  const original = document({ cards: [image, secondImage, model], edges: [edge, secondEdge], input_order: { model: { image: ['second-edge', 'edge'] } } })
  const copy = { ...model, id: 'copy' }
  const result = operations.copyIncoming(original, 'model', copy).document
  const incoming = result.edges.filter(edge => edge.target_card === 'copy')
  assert.equal(incoming.length, 2)
  assert.ok(incoming.every(edge => !['edge', 'second-edge'].includes(edge.id)))
  assert.deepEqual(result.input_order.copy.image.map(id => incoming.find(edge => edge.id === id).source_card), ['second-image', 'image'])
  assert.deepEqual(result.input_order.model.image, ['second-edge', 'edge'])
  assert.equal(original.cards.length, 3)
  assert.equal(original.edges.length, 2)
})


test('acceptance connections immediately associate, disconnect atomically and allow independent model design removal', () => {
  const criterion = { id: 'criterion', type: 'direction.criterion', criterion_id: 'hand', name: '手部可见' }
  const shot = { id: 'shot', type: 'direction.shot', input_bindings: [] }
  const relation = { id: 'acceptance', source_card: 'criterion', source_port: 'criterion', target_card: 'shot', target_port: 'acceptance_basis' }
  const original = document({ cards: [criterion, shot], edges: [], input_order: {} })
  const connected = operations.connect(original, relation).document
  assert.equal(connected.cards[1].input_bindings[0].source.object_id, 'hand')
  assert.equal(operations.clean(connected), connected)
  const disconnected = operations.disconnect(connected, relation).document
  assert.deepEqual(disconnected.cards[1].input_bindings, [])
  assert.deepEqual(disconnected.edges, [])
  const removed = operations.remove(connected, ['criterion'], new Set(), id => id).document
  assert.deepEqual(removed.cards[0].input_bindings, [])
  const direct = { ...model, input_bindings: [{ id: 'direct', input_port: 'text', source: { ...source, card_id: 'criterion', port_id: 'text' } }] }
  assert.ok(operations.remove({ ...connected, cards: [...connected.cards, direct] }, ['criterion'], new Set(), id => id).document)
  const legacy = { ...original, edges: [relation], input_order: { shot: { acceptance_basis: ['acceptance'] } } }
  assert.deepEqual(operations.clean(legacy).edges, [])
  assert.deepEqual(original.cards[1].input_bindings, [])
})

test('independent design connections adopt immediately and protect explicit whole-card references', async () => {
  const { connect } = rules
  const design = { id: 'design', type: 'direction.guidance' }
  const receiver = { ...model, input_bindings: [] }
  const link = { ...edge, source_card: 'design', source_port: 'text', target_port: 'text' }
  const original = document({ cards: [design, receiver], edges: [], input_order: {} })
  const connected = connect(original, link)
  assert.equal(connected.cards[1].input_bindings.length, 1)
  assert.equal(operations.disconnect(connected, link).document.cards[1].input_bindings.length, 0)
  const binding = connected.cards[1].input_bindings[0]
  connected.cards[1].prompt.segments = [{ id: 'reference', kind: 'reference', binding_id: binding.id, source: binding.source }]
  assert.match(operations.disconnect(connected, link).reason, /仍有输入被引用/)
  const restored = connect({ ...connected, edges: [], input_order: {} }, { ...link, id: 'copied-edge' })
  assert.equal(restored.cards[1].input_bindings[0].id, binding.id, 'recreating an incoming edge preserves copied prompt references')
})

test('whole movement target protects deletion until composition releases its reference', () => {
  const movement = { id: 'movement', type: 'direction.movement' }
  const composition = { id: 'composition', type: 'direction.composition', frame_target: { card_id: 'movement', state_id: 'phase:end' }, input_bindings: [] }
  const original = document({ cards: [movement, composition], edges: [], input_order: {} })
  assert.equal(operations.remove(original, ['movement'], new Set(), id => id).protection.referenceId, 'frame_target')
  assert.ok(operations.remove({ ...original, cards: [movement, { ...composition, frame_target: null }] }, ['movement'], new Set(), id => id).document)
})

test('a newly created model draft adopts independent design before its first save', async () => {
  const { connect } = rules
  const draft = { id: 'model', type: 'model.text', prompt: { segments: [] }, config: {} }
  const original = document({ cards: [{ id: 'design', type: 'direction.guidance' }, draft], edges: [], input_order: {} })
  const connected = connect(original, { ...edge, source_card: 'design', source_port: 'text', target_port: 'text' })
  assert.equal(connected.cards[1].input_bindings.length, 1)
  assert.equal(operations.clean(connected).edges.length, 1)
})

test('clearing a prompt reference keeps the independent design association until explicitly disconnected', async () => {
  const { connect } = rules
  const { withEditorPrompt } = await import(await moduleUrl('inputBindings'))
  const receiver = { id: 'model', type: 'model.video', prompt: { segments: [] }, input_bindings: [] }
  const connected = connect(document({ cards: [{ id: 'design', type: 'direction.guidance' }, receiver], edges: [], input_order: {} }), { ...edge, source_card: 'design', source_port: 'text', target_port: 'text' })
  const source = connected.cards[1].input_bindings[0].source
  const referenced = withEditorPrompt(connected.cards[1], { segments: [{ id: 'explicit', kind: 'reference', source }] })
  const cleared = withEditorPrompt(referenced, { segments: [] })
  const updated = operations.update({ ...connected, cards: [connected.cards[0], referenced] }, cleared).document
  assert.equal(updated.edges.length, 1)
  assert.equal(updated.cards[1].input_bindings.length, 1)
})

test('acceptance source has a single directly adopted use and disconnect removes it', async () => {
  const rules = createGraphRules({ connection_policies, cards: [definition('direction.criterion', [port('text', 'text'), port('criterion', 'criterion')]), definition('direction.shot', [], [input('text', 'text'), input('acceptance_basis', 'criterion')])] })
  const operations = createCanvasOperations(rules)
  const cards = [{ id: 'criterion', type: 'direction.criterion', criterion_id: 'rule', name: '可见' }, { id: 'shot', type: 'direction.shot', input_bindings: [] }]
  const edge = { id: 'source', source_card: 'criterion', source_port: 'criterion', target_card: 'shot', target_port: 'acceptance_basis' }
  const connected = operations.connect(document({ cards, edges: [], input_order: {} }), edge).document
  assert.equal(connected.edges.length, 1)
  assert.equal(connected.cards[1].input_bindings[0].input_port, 'acceptance_basis')
  const disconnected = operations.disconnect(connected, edge).document
  assert.equal(disconnected.edges.length, 0)
  assert.equal(disconnected.cards[1].input_bindings.length, 0)
})

test('empty acceptance names reject connection before changing the document', () => {
  for (const name of ['', '   ', undefined]) {
    const cards = [{ id: 'criterion', type: 'direction.criterion', criterion_id: 'rule', name }, { id: 'shot', type: 'direction.shot', input_bindings: [] }]
    const edge = { id: 'source', source_card: 'criterion', source_port: 'criterion', target_card: 'shot', target_port: 'acceptance_basis' }
    const rules = createGraphRules({ connection_policies, cards: [definition('direction.criterion', [port('text', 'text'), port('criterion', 'criterion')]), definition('direction.shot', [], [input('text', 'text'), input('acceptance_basis', 'criterion')])] })
    const original = document({ cards, edges: [], input_order: {} })
    const before = structuredClone(original)
    const result = createCanvasOperations(rules).connect(original, edge)
    assert.equal(result.reason, '请先填写验收要求名称')
    assert.equal(result.document, undefined)
    assert.deepEqual(original, before)
  }
})


test('composition disconnect protects all other uses before asking to clear its frame', () => {
  const movement = { id: 'movement', type: 'direction.movement' }
  const edge = { id: 'frame', source_card: 'movement', source_port: 'text', target_card: 'composition', target_port: 'text' }
  const composition = { id: 'composition', type: 'direction.composition', frame_target: { card_id: 'movement', state_id: 'field:end_frame' }, input_bindings: [] }
  const doc = document({ cards: [movement, composition], edges: [edge], input_order: {} })
  assert.equal(operations.disconnect(doc, edge).confirmFrame, true)
  const removed = operations.disconnect(doc, edge, true).document
  assert.equal(removed.cards[1].frame_target, null)
  assert.equal(removed.edges.length, 0)
  const protectedDoc = structuredClone(doc)
  protectedDoc.cards[1].input_bindings = [
    { id: 'one', input_port: 'text', source: { canvas_id: 'canvas', card_id: 'movement', port_id: 'text', position: 0 } },
    { id: 'two', input_port: 'text', source: { canvas_id: 'canvas', card_id: 'movement', port_id: 'text', position: 1 } },
  ]
  const blocked = operations.disconnect(protectedDoc, edge)
  assert.equal(blocked.confirmFrame, undefined)
  assert.equal(blocked.protection.blockers.length, 2)
  assert.match(blocked.reason, /one/)
  assert.match(blocked.reason, /two/)
  assert.equal(protectedDoc.edges.length, 1)
})

test('direct acceptance cancellation removes the connection in the same update', () => {
  const source = { id: 'criterion', type: 'direction.criterion', criterion_id: 'rule', name: '清晰' }
  const target = { id: 'shot', type: 'direction.shot', input_bindings: [] }
  const edge = { id: 'rule', source_card: 'criterion', source_port: 'criterion', target_card: 'shot', target_port: 'acceptance_basis' }
  const connected = operations.connect(document({ cards: [source, target], edges: [], input_order: {} }), edge).document
  const removed = operations.update(connected, { ...connected.cards[1], input_bindings: [] }).document
  assert.equal(removed.edges.length, 0)
  assert.equal(removed.cards[1].input_bindings.length, 0)
})


test('restoring equal multi-use source documents produces equal stable edge identities', () => {
  const connection_policies = ['text', 'beat'].map(port => ({ source_type: 'direction.beat', source_port: port, target_type: 'direction.performance', target_port: port, connect: 'candidate', cancel: 'keep_connection', disconnect: 'protect', adoption_allowed: true }))
  const localRules = createGraphRules({ connection_policies, cards: [definition('direction.beat', [port('text', 'text'), port('beat', 'beat')]), definition('direction.performance', [], [input('text', 'text'), input('beat', 'beat')])] })
  const localOperations = createCanvasOperations(localRules)
  const original = document({ cards: [{ id: 'beat', type: 'direction.beat' }, { id: 'performance', type: 'direction.performance', input_bindings: [] }], edges: [{ id: 'old', source_card: 'beat', source_port: 'text', target_card: 'performance', target_port: 'text' }], input_order: {} })
  const first = localOperations.clean(structuredClone(original)), second = localOperations.clean(structuredClone(original))
  assert.deepEqual(first, second)
  assert.equal(first.edges.length, 2)
  assert.equal(localOperations.clean(first), first)
  const adoptedOnly = structuredClone(original)
  adoptedOnly.edges = []
  adoptedOnly.cards[0].beat_id = 'beat-id'
  adoptedOnly.cards[1].input_bindings = [{ id: 'adopted', input_port: 'beat', source: { canvas_id: 'canvas', card_id: 'beat', port_id: 'beat', object_id: 'beat-id', position: 0 } }]
  const restored = localOperations.clean(adoptedOnly)
  assert.equal(restored.edges.length, 2)
  assert.equal(localOperations.clean(restored), restored)

})
