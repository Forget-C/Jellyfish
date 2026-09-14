import { useEffect, useState } from 'react'
import { Alert, Button, Card, Image, Input, InputNumber, Modal, Pagination, Select, Space, Typography, Upload } from 'antd'
import { LlmService, StudioFilesService } from '../../../services/generated'
import type { FileRead, GenerationUnit_Input, ModelRead, ProductionPlan_Input, SceneDesign_Input, ReferenceBinding_Input } from '../../../services/generated'
import { buildFileDownloadUrl } from '../assets/utils'
import { directingError } from './common'

/** 拍摄单元和本轮参考的显式编辑，关联资产不会自动全量提交。 */
export function PlanEditor({ projectId, design, value, onChange, disabled = false }: {
  projectId: string; design: SceneDesign_Input; value: ProductionPlan_Input; onChange: (plan: ProductionPlan_Input) => void; disabled?: boolean
}) {
  const [models, setModels] = useState<ModelRead[]>([])
  const [defaultModel, setDefaultModel] = useState('')
  const [error, setError] = useState('')
  const [picker, setPicker] = useState<string>()
  const [files, setFiles] = useState<FileRead[]>([])
  const [query, setQuery] = useState('')
  const [page, setPage] = useState(1)
  const [total, setTotal] = useState(0)
  const [allFiles, setAllFiles] = useState(false)
  useEffect(() => {
    void Promise.all([LlmService.listModelsApiV1LlmModelsGet({ category: 'video', pageSize: 100 }), LlmService.getModelSettingsApiV1LlmModelSettingsGet()]).then(([list, settings]) => {
      setModels(list.data?.items || []); setDefaultModel(settings.data?.default_video_model_id || '')
    }).catch(cause => setError(directingError(cause)))
  }, [])
  /** 仅替换当前单元，其他单元与已确认版本保持原样。 */
  const patch = (id: string, update: Partial<GenerationUnit_Input>) => onChange({ ...value, units: value.units.map(unit => unit.id === id ? { ...unit, ...update } : unit) })
  /** 用户选择新镜头范围后建立稳定出现项，部分动作可继续手工缩小。 */
  const coverage = (shotIds: string[]) => shotIds.map(shotId => {
    const shot = design.direction.shots.find(item => item.id === shotId)!
    return { id: 'coverage-' + crypto.randomUUID().slice(0, 8), shot_id: shot.id, beat_ids: shot.beat_ids,
      event_ids: shot.event_ids, action_scope: shot.visible_result.text || '请描述本次要拍的动作范围' }
  })
  /** 查询现有素材，默认只展示当前项目关联项，也可明确选择公共文件。 */
  const loadFiles = async (next = 1, global = allFiles) => {
    try {
      const response = await StudioFilesService.listFilesApiApiV1StudioFilesGet({ projectId: global ? undefined : projectId, q: query, page: next, pageSize: 20 })
      setFiles((response.data?.items || []).filter(file => file.type === 'image'))
      setTotal(response.data?.pagination.total || 0); setPage(next)
    } catch (cause) { setError(directingError(cause)) }
  }
  /** 明确添加一份文件；输入位置和用途仍可在单元内调整。 */
  const addReference = (fileId: string, unitId = picker) => {
    const unit = value.units.find(item => item.id === unitId)
    if (!unit || unit.references.some(ref => ref.file_id === fileId)) return
    patch(unit.id, { references: [...unit.references, { id: 'ref-' + crypto.randomUUID().slice(0, 8), file_id: fileId, media_kind: 'image', purpose: 'composition', participant_ids: [], ordinal: unit.references.length, input_role: 'first_frame', source: { kind: 'human', reference: 'local-user', version: 'reference-1' } }] })
  }
  return <Space direction="vertical" size="middle" style={{ width: '100%' }}>
    {error && <Alert type="error" message={error} closable onClose={() => setError('')} />}
    {value.units.map((unit, index) => <Card key={unit.id} title={`试拍单元 ${index + 1}`} extra={!disabled && <Button danger onClick={() => onChange({ ...value, units: value.units.filter(item => item.id !== unit.id) })}>移除单元</Button>}>
      <Space direction="vertical" style={{ width: '100%' }}>
        <Typography.Text>本次覆盖镜头</Typography.Text>
        <Select mode="multiple" disabled={disabled} style={{ width: '100%' }} value={unit.coverage.map(item => item.shot_id)} options={design.direction.shots.map((shot, i) => ({ value: shot.id, label: `镜头 ${i + 1} · ${shot.visible_result.text || '待确定内容'}` }))} onChange={ids => patch(unit.id, { coverage: coverage(ids) })} />
        {unit.coverage.map(item => <div key={item.id} style={{ width: '100%' }}><Typography.Text type="secondary">动作范围 · {item.shot_id}</Typography.Text><Input.TextArea disabled={disabled} value={item.action_scope} onChange={event => patch(unit.id, { coverage: unit.coverage.map(row => row.id === item.id ? { ...row, action_scope: event.target.value } : row) })} /></div>)}
        {unit.coverage.length > 1 && <Alert type="warning" message="计划包含多个镜头，当前多镜执行能力未验证。保存并确认后，可在重组面板明确拆分。" />}
        <Space wrap>
          <Select aria-label="视频模型" disabled={disabled} placeholder="选择视频模型" style={{ minWidth: 220 }} value={unit.model_id || undefined} options={models.map(model => ({ value: model.id, label: model.name }))} onChange={model_id => patch(unit.id, { model_id })} />
          <span>时长（秒）</span><InputNumber disabled={disabled} min={1} precision={0} value={unit.duration_ms / 1000} onChange={seconds => patch(unit.id, { duration_ms: (seconds || 1) * 1000 })} />
          <Select aria-label="画幅" disabled={disabled} value={unit.ratio} options={['16:9', '9:16', '1:1', '4:3', '3:4', '21:9'].map(ratio => ({ value: ratio, label: ratio }))} onChange={ratio => patch(unit.id, { ratio })} />
          <span>种子（可留空）</span><InputNumber disabled={disabled} min={-1} precision={0} value={typeof unit.parameters?.seed === 'number' ? unit.parameters.seed : null} onChange={seed => patch(unit.id, { parameters: seed === null ? {} : { seed } })} />
        </Space>
        <Typography.Text strong>本次参考素材</Typography.Text>
        {!unit.references.length && <Typography.Text type="secondary">尚未选入参考。是否可以纯文本试拍由目标模型决定。</Typography.Text>}
        {unit.references.map((ref, refIndex) => <Card key={ref.id} size="small" style={{ width: '100%' }}>
          <Space wrap><Image width={72} height={72} style={{ objectFit: 'cover' }} src={buildFileDownloadUrl(ref.file_id)} />
            <span>参考 {refIndex + 1}</span>
            <Select disabled={disabled} value={ref.purpose} style={{ width: 125 }} options={[{ value: 'identity', label: '人物身份' }, { value: 'space', label: '场所空间' }, { value: 'composition', label: '构图' }, { value: 'continuity', label: '连续性' }, { value: 'performance', label: '表演' }]} onChange={purpose => patch(unit.id, { references: unit.references.map(r => r.id === ref.id ? { ...r, purpose } : r) })} />
            <Select disabled={disabled} value={ref.input_role} style={{ width: 145 }} options={[{ value: 'first_frame', label: '首帧构图' }, { value: 'last_frame', label: '尾帧构图' }, { value: 'key_frame', label: '关键帧' }, { value: 'subject', label: '命名主体参考' }]} onChange={input_role => patch(unit.id, { references: unit.references.map(r => r.id === ref.id ? { ...r, input_role } : r) })} />
            <Select mode="multiple" disabled={disabled} placeholder="绑定人物/物件" style={{ minWidth: 180 }} value={ref.participant_ids} options={design.participants.map(p => ({ value: p.id, label: p.name }))} onChange={participant_ids => patch(unit.id, { references: unit.references.map(r => r.id === ref.id ? { ...r, participant_ids } : r) })} />
            {!disabled && <><Button disabled={refIndex === 0} onClick={() => {
              const next: ReferenceBinding_Input[] = [...unit.references]; [next[refIndex - 1], next[refIndex]] = [next[refIndex], next[refIndex - 1]]
              patch(unit.id, { references: next.map((r, ordinal) => ({ ...r, ordinal })) })
            }}>上移</Button><Button danger onClick={() => patch(unit.id, { references: unit.references.filter(r => r.id !== ref.id).map((r, ordinal) => ({ ...r, ordinal })) })}>移除</Button></>}
          </Space>
        </Card>)}
        {!disabled && <Space><Button onClick={() => { setPicker(unit.id); void loadFiles() }}>从素材中选择</Button><Upload accept="image/*" showUploadList={false} beforeUpload={file => {
          void StudioFilesService.uploadFileApiApiV1StudioFilesUploadPost({ formData: { file: file as unknown as string, project_id: projectId, usage_kind: 'upload' } }).then(response => { if (response.data) addReference(response.data.id, unit.id) }).catch(cause => setError(directingError(cause)))
          return false
        }}><Button>上传参考图</Button></Upload></Space>}
      </Space>
    </Card>)}
    {!disabled && <Button disabled={!design.direction.shots.length} onClick={() => onChange({ ...value, units: [...value.units, { id: 'unit-' + crypto.randomUUID().slice(0, 8), coverage: coverage([design.direction.shots[0].id]), references: [], model_id: defaultModel, duration_ms: 5000, ratio: '16:9', capability: { multi_shot: 'unknown' } }] })}>新增试拍 / 补拍单元</Button>}
    <Modal title="选择本次参考图" open={!!picker} onCancel={() => setPicker(undefined)} footer={<Button onClick={() => setPicker(undefined)}>完成选择</Button>}>
      <Space direction="vertical" style={{ width: '100%' }}><Input.Search placeholder="搜索素材" value={query} onChange={event => setQuery(event.target.value)} onSearch={() => void loadFiles()} />
        <Select value={allFiles ? 'all' : 'project'} options={[{ value: 'project', label: '当前项目素材' }, { value: 'all', label: '全部已有素材' }]} onChange={scope => { setAllFiles(scope === 'all'); void loadFiles(1, scope === 'all') }} />
        {files.map(file => <Space key={file.id}><Image width={60} src={file.thumbnail || buildFileDownloadUrl(file.id)} /><span>{file.name}</span><Button onClick={() => addReference(file.id)}>选入</Button></Space>)}
        <Pagination current={page} total={total} pageSize={20} onChange={next => void loadFiles(next)} /></Space>
    </Modal>
  </Space>
}
