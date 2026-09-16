import type { AssetSummary, SceneDesign_Input } from '../../../services/generated'

/** 按类型和身份去重，只将当前项目可解析的引用计入有效关联；未加载不等于失效。 */
export function sceneAssetSummary(design: SceneDesign_Input, assets?: AssetSummary[]) {
  const references = new Map<string, { id: string; kind: AssetSummary['kind'] }>()
  const add = (kind: AssetSummary['kind'], id?: string | null) => { if (id) references.set(`${kind}:${id}`, { kind, id }) }
  add('scene', design.direction.location_asset_id)
  design.participants.forEach(person => { add('character', person.character_id); add('prop', person.prop_id) })
  const counts = { character: 0, scene: 0, prop: 0 }
  let invalid = 0
  if (assets) for (const reference of references.values()) {
    if (assets.some(asset => asset.id === reference.id && asset.kind === reference.kind)) counts[reference.kind] += 1
    else invalid += 1
  }
  return { counts, total: counts.character + counts.scene + counts.prop, invalid, references: references.size, verified: assets !== undefined }
}
