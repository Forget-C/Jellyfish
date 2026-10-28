import { Alert, Input, Select, Space } from 'antd'
import type { NamedImageReferenceCard, NamedImageObject, CanvasResolvedOutput, ObjectReferencePayload } from '../../../services/generated'
import { MediaContentEditor, MediaPreview } from './MediaContentEditor'
import { useCardCandidates } from './useCardCandidates'
import { sourceKey } from './promptRules'
import { WorkbenchButton } from '../directing/ui/WorkbenchButton'
import type { CardRendererProps } from './rendererRegistry'

const objectReference = (payload: CanvasResolvedOutput['payload']): payload is ObjectReferencePayload => payload?.kind === 'object_reference'
const categories = { character: '人物', place: '场所', prop: '道具', costume: '服装' }

/** 名称列表只渲染对象引用；图片选择独立，不展开名称来源描述。 */
export function NamedImageReferenceEditor({ card: raw, document, projectId, savedRevision, modelOutputs, references, onChange, onAddAngle, disabled }: CardRendererProps) {
  const card = raw as NamedImageReferenceCard
  const resolved = useCardCandidates(projectId, document.id, card.id, savedRevision, modelOutputs, false)
  const category = card.type.split('.')[1] as NamedImageObject['category']
  const allowed = category === 'character' ? ['character', 'costume', 'prop'] : [category]
  const bindings = card.input_bindings || []
  const names = resolved.candidates.filter(item => objectReference(item.payload) && allowed.includes(item.payload.category))
  const selectedNames = names.filter(item => bindings.some(binding => sourceKey(binding.source) === sourceKey(item.source)))
  const primaryBound = selectedNames.some(item => objectReference(item.payload) && item.payload.category === category)
  const objects = card.objects || []
  const updateObject = (id: string, patch: Partial<NamedImageObject>) => onChange({ ...card, objects: objects.map(item => item.object_id === id ? { ...item, ...patch } : item) })
  return <Space direction="vertical" style={{ width: '100%' }}>
    <label>参考标题<Input aria-label="参考标题" disabled={disabled} value={card.title || ''} onChange={event => onChange({ ...card, title: event.target.value })} /></label>
    <label>参考角度<Input aria-label="参考角度" disabled={disabled} value={card.angle ?? '正面'} onChange={event => onChange({ ...card, angle: event.target.value })} /></label>
    <small>参考角度描述这张主图；最终画面视角由生成要求决定。</small>
    <section aria-label="添加另一角度参考">
      {resolved.outputs.filter(item => objectReference(item.payload)).map(item => objectReference(item.payload) && <WorkbenchButton key={sourceKey(item.source)} disabled={disabled || !onAddAngle}
        onClick={() => onAddAngle?.(item)}>添加另一角度参考 {item.payload.name}</WorkbenchButton>)}
      <small>明确复用所选对象身份；新卡主图和角度独立选择。</small>
    </section>
    {references}
    {resolved.error && <Alert type="error" message={resolved.error} />}
    <section aria-label="名称关联">
      <h3>名称关联</h3>
      {names.map(item => {
        if (!objectReference(item.payload)) return null
        const payload = item.payload
        const binding = bindings.find(binding => sourceKey(binding.source) === sourceKey(item.source))
        const ownsPrimary = objects.some(obj => obj.category === category)
        return <div key={sourceKey(item.source)}><span>{payload.name} · {categories[payload.category]} · {payload.object_id}</span>
          <WorkbenchButton disabled={disabled || (!binding && payload.category === category && ownsPrimary)}
            onClick={() => onChange({ ...card, input_bindings: binding ? bindings.filter(value => value.id !== binding.id) : [...bindings, { id: crypto.randomUUID(), input_port: 'name', source: item.source }] })}>
            {binding ? '取消名称' : '关联名称'} {payload.name}
          </WorkbenchButton>
          {binding && <Input aria-label={`图内位置 ${payload.name}`} placeholder="必要图内位置" value={card.positions?.[payload.object_id] || ''}
            disabled={disabled} onChange={event => onChange({ ...card, positions: { ...card.positions, [payload.object_id]: event.target.value } })} />}
        </div>
      })}
      {!names.length && <p>连接对象引用以选择名称；可直接独立命名。</p>}
      {objects.map(obj => <div key={obj.object_id}>
        <label>独立名称<Input aria-label="独立对象名称" value={obj.name} disabled={disabled} onChange={event => updateObject(obj.object_id, { name: event.target.value })} /></label>
        <Select aria-label="参考对象类别" value={obj.category} disabled={disabled} options={allowed.map(value => ({ value, label: categories[value as keyof typeof categories] }))}
          onChange={value => updateObject(obj.object_id, { category: value })} />
        <Input aria-label={`图内位置 ${obj.name}`} placeholder="必要图内位置" disabled={disabled} value={obj.position || ''} onChange={event => updateObject(obj.object_id, { position: event.target.value })} />
        <WorkbenchButton disabled={disabled} onClick={() => onChange({ ...card, objects: objects.filter(item => item.object_id !== obj.object_id) })}>移除独立对象 {obj.name}</WorkbenchButton>
      </div>)}
      <WorkbenchButton disabled={disabled || primaryBound} onClick={() => onChange({ ...card, objects: [...objects, { object_id: crypto.randomUUID(), name: '', category, position: '' }] })}>独立命名{categories[category]}</WorkbenchButton>
    </section>
    <section aria-label="主图选择">
      <h3>主图</h3>
      {card.image_binding && <><MediaPreview fileId={card.image_binding.file_id} type="image" /><p>固定文件 {card.image_binding.file_id} · {card.image_binding.source ? `来源 ${card.image_binding.source.card_id} / 输出 ${card.image_binding.source.position + 1}` : '项目文件'}</p>
        <WorkbenchButton disabled={disabled} onClick={() => onChange({ ...card, image_binding: null })}>取消主图</WorkbenchButton></>}
      {resolved.candidates.filter(item => item.modality === 'image').map(item => <div key={sourceKey(item.source)}>
        {item.file_id && <MediaPreview fileId={item.file_id} type="image" />}
        <WorkbenchButton disabled={disabled || !item.available || !item.file_id} onClick={() => onChange({ ...card,
          image_binding: { source: item.source, file_id: item.file_id!, result_set_id: item.result_set_id } })}>选为主图 {item.token}</WorkbenchButton>
      </div>)}
      <Alert type="info" message="换图后请核对角度与图内位置；名称绑定会保留。" />
      <MediaContentEditor card={{ id: card.id, type: 'content.image', file_id: null }} projectId={projectId} disabled={disabled}
        onChange={media => { if (media.file_id && !media.uploading) onChange({ ...card, image_binding: { file_id: media.file_id } }) }} />
    </section>
  </Space>
}
