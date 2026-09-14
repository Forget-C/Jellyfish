import { useEffect, useState } from 'react'
import { Alert, Button, Card, Input, Select, Space, Typography } from 'antd'
import { LlmService, StudioDirectingService, StudioFilesService } from '../../../services/generated'
import type { FileRead, ModelRead, WorkspaceRead, VisualRequest } from '../../../services/generated'
import { directingError } from './common'

/** 用明确的设计与图片输入生成关系、构图等候选图，不自动采用为正式参考。 */
export function VisualPanel({ projectId, workspace, onSubmitted }: { projectId: string; workspace: WorkspaceRead; onSubmitted: () => void }) {
  const [modelId, setModelId] = useState<string>()
  const [models, setModels] = useState<ModelRead[]>([])
  const [files, setFiles] = useState<FileRead[]>([])
  const [designId, setDesignId] = useState<string>()
  const [purpose, setPurpose] = useState<VisualRequest['purpose']>('composition')
  const [ratio, setRatio] = useState<VisualRequest['ratio']>('16:9')
  const [prompt, setPrompt] = useState('')
  const [references, setReferences] = useState<string[]>([])
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState('')
  useEffect(() => {
    void LlmService.listModelsApiV1LlmModelsGet({ category: 'image', pageSize: 100 }).then(response => setModels(response.data?.items || [])).catch(cause => setError(directingError(cause)))
  }, [])
  /** 在本项目素材内搜索，选择顺序就是本次参考输入顺序。 */
  const searchFiles = async (q: string) => {
    try { const response = await StudioFilesService.listFilesApiApiV1StudioFilesGet({ projectId, q, pageSize: 50 }); setFiles((response.data?.items || []).filter(file => file.type === 'image')) }
    catch (cause) { setError(directingError(cause)) }
  }
  return <Card title="关系与构图验证图">
    <Space direction="vertical" className="w-full">
      {error && <Alert type="error" message={error} />}
      <Typography.Text type="secondary">按需生成一张验证图即可。结果保留为候选；在生产计划中明确选择后才成为本次参考，不替换资产默认图。</Typography.Text>
      <Select aria-label="验证图设计版本" placeholder="选择已确认设计" value={designId} options={workspace.designs.filter(row => row.confirmed_at && row.source_current).map((row, index) => ({ value: row.id, label: `设计 ${index + 1} · v${row.version}` }))} onChange={setDesignId} />
      <Space wrap><Select aria-label="验证目的" value={purpose} options={[{ value: 'identity', label: '形象' }, { value: 'space', label: '空间关系' }, { value: 'composition', label: '构图' }, { value: 'continuity', label: '连续性' }]} onChange={setPurpose} />
        <Select aria-label="验证图画幅" value={ratio} options={['16:9', '9:16', '1:1'].map(value => ({ value, label: value }))} onChange={setRatio} />
        <Select aria-label="验证图模型" allowClear placeholder="使用默认图片模型" className="min-w-64" value={modelId} options={models.map(model => ({ value: model.id, label: model.name }))} onChange={setModelId} /></Space>
      <Select mode="multiple" aria-label="验证图参考素材" placeholder="搜索本项目参考图（可留空）" showSearch filterOption={false} onSearch={q => { void searchFiles(q) }} onFocus={() => { void searchFiles('') }} value={references} options={files.map(file => ({ value: file.id, label: file.name }))} onChange={setReferences} />
      <Input.TextArea aria-label="验证图描述" placeholder="描述本次要验证的人物关系、空间或构图；发送这里填写的画面要求、明确选择的参考及所选设计的适用项目风格" value={prompt} onChange={event => setPrompt(event.target.value)} autoSize={{ minRows: 3 }} />
      <Button type="primary" loading={busy} disabled={!designId || !prompt.trim()} onClick={async () => {
        if (!designId) return
        setBusy(true); setError('')
        try { await StudioDirectingService.directingGenerateVisual({ projectId, sequenceId: workspace.sequence.id, requestBody: { design_revision_id: designId, model_id: modelId, purpose, prompt, reference_file_ids: references, ratio } }); onSubmitted() }
        catch (cause) { setError(directingError(cause)) } finally { setBusy(false) }
      }}>生成候选验证图</Button>
    </Space>
  </Card>
}
