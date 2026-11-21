import { useUiText } from '../../../../uiText'
import { Input } from 'antd'

export type StructuredAssetType = 'actor' | 'scene' | 'prop' | 'costume'
export type AssetFieldName = 'age_appearance' | 'gender' | 'build' | 'facial_features' | 'skin_tone' | 'hair' | 'scene_type' | 'spatial_layout' | 'environment_features' | 'materials' | 'color_palette' | 'prop_type' | 'shape' | 'size_description' | 'colors' | 'costume_type' | 'structure' | 'patterns_accessories'
export type AssetFacts = Partial<Record<AssetFieldName, string | null>> & { supplementary_info?: string }

export const ASSET_FIELDS: Record<StructuredAssetType, { key: AssetFieldName; label: string; maxLength: number; fullWidth?: boolean }[]> = {
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
    { key: 'spatial_layout', label: '空间布局', maxLength: 2000, fullWidth: true },
    { key: 'environment_features', label: '环境特征', maxLength: 2000, fullWidth: true },
    { key: 'materials', label: '主要材质', maxLength: 2000 },
    { key: 'color_palette', label: '色彩', maxLength: 2000 },
  ],
  prop: [
    { key: 'prop_type', label: '道具类型', maxLength: 200 },
    { key: 'shape', label: '外形结构', maxLength: 2000, fullWidth: true },
    { key: 'size_description', label: '尺寸或相对尺度', maxLength: 200 },
    { key: 'materials', label: '材质', maxLength: 2000 },
    { key: 'colors', label: '颜色', maxLength: 2000 },
  ],
  costume: [
    { key: 'costume_type', label: '服装类型', maxLength: 200 },
    { key: 'structure', label: '款式层次', maxLength: 2000, fullWidth: true },
    { key: 'materials', label: '材质', maxLength: 2000 },
    { key: 'colors', label: '颜色', maxLength: 2000 },
    { key: 'patterns_accessories', label: '纹样与附属配饰', maxLength: 2000, fullWidth: true },
  ],
}

// 档案头只放简短的识别属性，长描述保留在下方分类设定中。
export const OVERVIEW_FIELDS: Record<StructuredAssetType, AssetFieldName[]> = {
  actor: ['age_appearance', 'gender'],
  scene: ['scene_type'],
  prop: ['prop_type', 'size_description'],
  costume: ['costume_type'],
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

/** 按档案区域复用分类字段；弹窗默认展示全部字段与描述预览，未知值允许留空。 */
export function AssetFactsFields({ type, value, onChange, supplementaryInfo, disabled = false, section = 'all', expandLongFields = false }: {
  type: StructuredAssetType
  value: AssetFacts
  onChange: (next: AssetFacts) => void
  supplementaryInfo: string
  disabled?: boolean
  section?: 'all' | 'overview' | 'details'
  expandLongFields?: boolean
}) {
  const uiText = useUiText()
  const fields = ASSET_FIELDS[type].filter(({ key }) => section === 'all'
    || OVERVIEW_FIELDS[type].includes(key) === (section === 'overview'))
  // 详细设定先排列短属性，空间、结构等长描述按字段定义占满一行。
  if (section === 'details') fields.sort((a, b) => a.maxLength - b.maxLength)

  return (
    <div className="space-y-3">
      {section === 'all' ? <div className="text-sm text-gray-600">{uiText("分类设定（未确定的项目可留空）")}</div> : null}
      <div className={section === 'all' ? 'grid grid-cols-1 sm:grid-cols-2 gap-3' : 'asset-dossier-fields'}>
        {fields.map(({ key, label, maxLength, fullWidth }) => (
          <label key={key} className={`block min-w-0 text-sm text-gray-600 ${section === 'details' && (fullWidth || (expandLongFields && maxLength > 200)) ? 'col-span-full' : ''}`}>
            {uiText(label)}
            <Input.TextArea
              className="mt-1"
              autoSize={{ minRows: 1, maxRows: 4 }}
              value={value[key] ?? ''}
              maxLength={maxLength}
              disabled={disabled}
              placeholder={section === 'all' ? undefined : uiText("未设定")}
              onChange={(event) => onChange({ ...value, [key]: event.target.value || null })}
            />
          </label>
        ))}
      </div>
      {section === 'all' ? <details className="text-sm text-gray-500">
        <summary>{uiText("完整描述预览")}</summary>
        <div className="whitespace-pre-wrap mt-2">{previewAssetDescription(type, value, supplementaryInfo) || uiText("尚未填写设定")}</div>
      </details> : null}
    </div>
  )
}
