import { Input } from 'antd'

export type StructuredAssetType = 'actor' | 'scene' | 'prop' | 'costume'
export type AssetFieldName = 'age_appearance' | 'gender' | 'build' | 'facial_features' | 'skin_tone' | 'hair' | 'scene_type' | 'spatial_layout' | 'environment_features' | 'materials' | 'color_palette' | 'prop_type' | 'shape' | 'size_description' | 'colors' | 'costume_type' | 'structure' | 'patterns_accessories'
export type AssetFacts = Partial<Record<AssetFieldName, string | null>> & { supplementary_info?: string }

export const ASSET_FIELDS: Record<StructuredAssetType, { key: AssetFieldName; label: string; maxLength: number }[]> = {
  actor: [
    { key: 'age_appearance', label: '外观年龄', maxLength: 200 },
    { key: 'gender', label: '性别设定', maxLength: 200 },
    { key: 'build', label: '体型', maxLength: 200 },
    { key: 'facial_features', label: '五官特征', maxLength: 2000 },
    { key: 'skin_tone', label: '肤色', maxLength: 200 },
    { key: 'hair', label: '发型发色', maxLength: 2000 },
  ],
  scene: [
    { key: 'scene_type', label: '场所类型', maxLength: 200 },
    { key: 'spatial_layout', label: '空间布局', maxLength: 2000 },
    { key: 'environment_features', label: '环境特征', maxLength: 2000 },
    { key: 'materials', label: '主要材质', maxLength: 2000 },
    { key: 'color_palette', label: '色彩', maxLength: 2000 },
  ],
  prop: [
    { key: 'prop_type', label: '道具类型', maxLength: 200 },
    { key: 'shape', label: '外形结构', maxLength: 2000 },
    { key: 'size_description', label: '尺寸或相对尺度', maxLength: 200 },
    { key: 'materials', label: '材质', maxLength: 2000 },
    { key: 'colors', label: '颜色', maxLength: 2000 },
  ],
  costume: [
    { key: 'costume_type', label: '服装类型', maxLength: 200 },
    { key: 'structure', label: '款式层次', maxLength: 2000 },
    { key: 'materials', label: '材质', maxLength: 2000 },
    { key: 'colors', label: '颜色', maxLength: 2000 },
    { key: 'patterns_accessories', label: '纹样与附属配饰', maxLength: 2000 },
  ],
}

/** 只取当前类别的可编辑字段，防止将服务端摘要和关联信息回写。 */
export function pickAssetFacts(type: StructuredAssetType, asset: AssetFacts): AssetFacts {
  return Object.fromEntries(ASSET_FIELDS[type].map(({ key }) => [key, asset[key] ?? null]))
}

/** 在保存前预览分类设定；服务端会独立整理并返回最终描述。 */
export function previewAssetDescription(type: StructuredAssetType, facts: AssetFacts, supplement: string): string {
  return [...ASSET_FIELDS[type].flatMap(({ key, label }) => {
    const value = facts[key]?.trim()
    return value && value !== '不适用' ? [`${label}：${value}`] : []
  }), supplement.trim()].filter(Boolean).join('\n')
}

/** 复用分类设定表单，未知值允许留空，完整描述只供预览。 */
export function AssetFactsFields({ type, value, onChange, supplementaryInfo, disabled = false }: {
  type: StructuredAssetType
  value: AssetFacts
  onChange: (next: AssetFacts) => void
  supplementaryInfo: string
  disabled?: boolean
}) {
  return (
    <div className="space-y-3">
      <div className="text-sm text-gray-600">分类设定（未确定的项目可留空）</div>
      <div className="grid grid-cols-2 gap-3">
        {ASSET_FIELDS[type].map(({ key, label, maxLength }) => (
          <label key={key} className="text-sm text-gray-600">
            {label}
            <Input.TextArea
              className="mt-1"
              autoSize={{ minRows: 1, maxRows: 4 }}
              value={value[key] ?? ''}
              maxLength={maxLength}
              disabled={disabled}
              onChange={(event) => onChange({ ...value, [key]: event.target.value || null })}
            />
          </label>
        ))}
      </div>
      <details className="text-sm text-gray-500">
        <summary>完整描述预览</summary>
        <div className="whitespace-pre-wrap mt-2">{previewAssetDescription(type, value, supplementaryInfo) || '尚未填写设定'}</div>
      </details>
    </div>
  )
}
