import type { CanvasDocument, CanvasModelCapability, CanvasStoryboardObject, CanvasStoryboardShot, ImageContentCard, InputBinding, NamedImageReferenceCard } from '../../../services/generated'
import type { CanvasOperationResult, createCanvasOperations } from './canvasOperations'
import type { GenerationCard } from './graphRules'
import { bindingReferences } from './inputBindings'

type Operations = Pick<ReturnType<typeof createCanvasOperations>, 'update' | 'remove'>
type CapabilityFor = (card: GenerationCard) => CanvasModelCapability | undefined
type ReferenceChange = {
  shot: CanvasStoryboardShot
  object: CanvasStoryboardObject
  prior: NamedImageReferenceCard
  chosen: NamedImageReferenceCard
}

export function storyboardReferenceCard(document: CanvasDocument, id: string | undefined) {
  return document.cards?.find((card): card is NamedImageReferenceCard => card.id === id && !!card.type?.startsWith('reference.'))
}

export function storyboardImageCards(document: CanvasDocument) {
  return (document.cards ?? []).filter((card): card is ImageContentCard => card.type === 'content.image' && 'file_id' in card && !!card.file_id && !card.uploading)
}

export function storyboardImageBinding(document: CanvasDocument, image: ImageContentCard) {
  return { source: { canvas_id: document.id, card_id: image.id, port_id: 'image', position: 0 }, file_id: image.file_id! }
}

const modelUses = (shot: CanvasStoryboardShot, objectId: string) =>
  (shot.reference_uses ?? []).filter(use => use.object_id === objectId && shot.model_card_ids.includes(use.model_card_id))

/** 只改仍指向原有效参考的采用，用户自己取消或改绑的采用维持现状。 */
function synchronizeUses(document: CanvasDocument, changes: ReferenceChange[], operations: Operations, capabilityFor: CapabilityFor): CanvasOperationResult {
  if (!document.storyboard) return { document }
  const changed = new Map<string, boolean>()
  let next = document
  for (const { shot, object, prior, chosen } of changes) {
    if (chosen.image_binding && (chosen.name_binding?.object_id ?? chosen.object_id) !== object.object_id) {
      return { reason: '参考卡已改绑其他对象，请先核对对象身份' }
    }
    for (const use of modelUses(shot, object.object_id)) {
      const model = next.cards?.find(card => card.id === use.model_card_id)
      if (!model || model.type !== 'model.image' && model.type !== 'model.video' || !('prompt' in model)) continue
      const port = model.type === 'model.image' ? 'image' : 'subject_image'
      const bindings = model.input_bindings ?? []
      const existing = bindings.find(binding => binding.id === use.binding_id)
      if (use.active && (!existing || existing.source.card_id !== prior.id || existing.source.port_id !== 'image' || existing.input_port !== port)) continue
      if (!use.active && existing) continue
      const capability = capabilityFor(model)
      const replacement = chosen.image_binding && (existing?.source.card_id === chosen.id || capability?.input_ports.includes(port))
      if (chosen.image_binding && existing && !replacement) return { reason: '无法核实镜头模型对参考用途的支持，请先检查生产模型' }
      if (!existing && !replacement || existing?.source.card_id === chosen.id && replacement) continue
      if (existing && !replacement && (bindingReferences(model, existing.id).length ||
          ('frame_targets' in model && model.frame_targets?.some(target => target.binding_id === existing.id)))) {
        return { reason: '请先解除镜头模型正文或画面目标对该参考的引用' }
      }
      if (replacement && bindings.some(binding => binding.id !== use.binding_id && binding.input_port === port &&
          binding.source.card_id === chosen.id && binding.source.port_id === 'image')) {
        return { reason: '镜头已有人工采用的同一参考，请先在模型卡核对' }
      }
      const description = next.cards?.find(card => card.id === object.description_card_id)
      const input: InputBinding = { id: use.binding_id, input_port: port, prompt_owned: false,
        ...(port === 'subject_image' ? { subject_name: description && 'name' in description ? description.name : prior.name } : {}),
        ...existing, source: { canvas_id: document.id, card_id: chosen.id, port_id: 'image', position: 0 },
      }
      const nextBindings = existing ? bindings.flatMap(binding => binding.id === existing.id ? replacement ? [input] : [] : [binding])
        : [...bindings, input]
      const priorEdge = existing && next.edges?.find(edge => edge.source_card === prior.id && edge.source_port === 'image' &&
        edge.target_card === model.id && edge.target_port === port)
      const priorPosition = priorEdge ? (next.input_order?.[model.id]?.[port] ?? []).indexOf(priorEdge.id) : -1
      const result = operations.update(next, { ...model, input_bindings: nextBindings }, capability)
      if (!result.document) return result
      next = result.document
      if (replacement && priorPosition >= 0) {
        const replacementEdge = next.edges?.find(edge => edge.source_card === chosen.id && edge.source_port === 'image' &&
          edge.target_card === model.id && edge.target_port === port)
        if (replacementEdge) {
          const order = (next.input_order?.[model.id]?.[port] ?? []).filter(id => id !== replacementEdge.id)
          order.splice(priorPosition, 0, replacementEdge.id)
          next = { ...next, input_order: { ...next.input_order, [model.id]: { ...next.input_order?.[model.id], [port]: order } } }
        }
      }
      changed.set(use.binding_id, !!replacement)
    }
  }
  const storyboard = next.storyboard!
  return { document: { ...next, storyboard: { ...storyboard, shots: storyboard.shots.map(shot => ({ ...shot,
    reference_uses: shot.reference_uses?.map(use => changed.has(use.binding_id) ? { ...use, active: changed.get(use.binding_id)! } : use),
  })) } } }
}

/** 引用卡自己的换图入口和分镜设置共用一笔编辑。 */
export function updateStoryboardReference(document: CanvasDocument, card: GenerationCard, operations: Operations, capabilityFor: CapabilityFor, explicit = false): CanvasOperationResult {
  const result = operations.update(document, card, capabilityFor(card))
  if (!result.document || !document.storyboard || !('image_binding' in card)) return result
  const prior = storyboardReferenceCard(document, card.id)
  if (!prior) return result
  const chosen = storyboardReferenceCard(result.document, card.id)
  if (!chosen) return result
  if (!explicit && JSON.stringify(prior.image_binding ?? null) === JSON.stringify(chosen.image_binding ?? null)) return result
  const changes = document.storyboard.shots.flatMap(shot => document.storyboard!.objects.flatMap(object => {
    const referenceId = shot.reference_overrides?.[object.object_id] ?? object.reference_card_id
    return shot.object_ids.includes(object.object_id) && referenceId === card.id ? [{ shot, object, prior, chosen }] : []
  }))
  return changes.length ? synchronizeUses(result.document, changes, operations, capabilityFor) : result
}

/** 一镜一对象独立指定或恢复继承。替代卡与原对象共用身份，但使用可辨识的名称。 */
export function chooseStoryboardOverride(document: CanvasDocument, shotId: string, objectId: string, image: ImageContentCard | undefined,
  operations: Operations, capabilityFor: CapabilityFor): CanvasOperationResult {
  const storyboard = document.storyboard
  const shot = storyboard?.shots.find(row => row.shot_id === shotId)
  const object = storyboard?.objects.find(row => row.object_id === objectId)
  const inherited = storyboardReferenceCard(document, object?.reference_card_id)
  if (!storyboard || !shot || !object || !inherited || !shot.object_ids.includes(objectId)) return { reason: '当前镜头的对象参考已失效' }
  const overrides = { ...shot.reference_overrides }
  const current = storyboardReferenceCard(document, overrides[objectId])
  const prior = current ?? inherited
  let next = document, chosen = inherited
  if (image) {
    const shotCard = document.cards?.find(card => card.id === shot.card_id)
    const shotName = shotCard && 'name' in shotCard ? shotCard.name : '镜头'
    const label = `${(inherited.name || '对象').slice(0, 200)} · ${(shotName || '镜头').slice(0, 32)}`
    let name = label, sequence = 2
    while (document.cards?.some(card => card.type === inherited.type && 'name' in card && card.name === name)) name = `${label}（${sequence++}）`
    const variant: NamedImageReferenceCard = current ?? { id: crypto.randomUUID(), type: inherited.type, type_version: 2,
      name, angle: inherited.angle, object_id: objectId }
    if (!current) next = { ...next, cards: [...(next.cards ?? []), variant],
      groups: next.groups?.map(group => group.id === shot.group_id && group.kind !== 'stack'
        ? { ...group, card_ids: [...(group.card_ids ?? []), variant.id] } : group) }
    chosen = { ...variant, image_binding: storyboardImageBinding(document, image) }
    const edited = operations.update(next, chosen)
    if (!edited.document) return edited
    next = edited.document
    overrides[objectId] = chosen.id
  } else {
    delete overrides[objectId]
  }
  next = { ...next, storyboard: { ...storyboard,
    shots: storyboard.shots.map(row => row.shot_id === shotId ? { ...row, reference_overrides: overrides } : row) } }
  const synchronized = synchronizeUses(next, [{ shot, object, prior, chosen }], operations, capabilityFor)
  if (!synchronized.document || image || !current) return synchronized
  // 用户另外采用了替代卡时让它留在画布，恢复继承只改这一镜的受管使用。
  const removed = operations.remove(synchronized.document, [current.id], new Set(), () => current.name || '镜头参考')
  return removed.document ? removed : synchronized
}
