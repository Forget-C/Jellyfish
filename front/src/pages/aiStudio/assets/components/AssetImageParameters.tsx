import { useEffect, useState } from 'react'
import { Alert, Button, Input, Modal, Space } from 'antd'
import { FilmService, type ActorImageParametersRead } from '../../../../services/generated'

const labels: Record<string, string> = { framing_instruction: '构图', background_instruction: '背景', lighting_instruction: '灯光', visible_detail_instruction: '细节强调', negative_prompt: '排除内容', additional_instruction: '附加要求', edit_instruction: '修改要求', preserve_instruction: '保持内容' }

/** 只展示当前图片对应的已保存快照；切图卸载后丢弃旧响应，不拿当前配置补全历史。 */
export function AssetImageParameters({ type, assetId, imageId }: { type: string; assetId: string; imageId: number }) {
  const [data, setData] = useState<ActorImageParametersRead | null>()
  const [failed, setFailed] = useState(false)
  const [retry, setRetry] = useState(0)
  const [expanded, setExpanded] = useState(false)
  useEffect(() => {
    let active = true
    setData(undefined); setFailed(false)
    const request = FilmService.getAssetImageParametersApiV1FilmTasksAssetImagesEntityTypeEntityIdImageIdParametersGet({ entityType: type, entityId: assetId, imageId })
    void request.then(response => { if (active) setData(response.data ?? null) }).catch(() => { if (active) setFailed(true) })
    return () => { active = false; request.cancel() }
  }, [type, assetId, imageId, retry])
  if (failed) return <Alert type="error" message="读取本图生成记录失败" action={<Button onClick={() => setRetry(value => value + 1)}>重试记录</Button>} />
  if (data === undefined) return <span role="status">正在读取生成记录…</span>
  if (data === null) return null
  return <div className="actor-image-parameters">
    <Space wrap><strong>本图生成记录</strong><span>{new Date(data.created_at_ts * 1000).toLocaleString()}</span>{(data.execution_prompt || Object.keys(data.parameters ?? {}).length > 0) && <Button type="link" onClick={() => setExpanded(true)}>查看参数</Button>}</Space>
    <Space wrap>{data.model_name && <span>模型：{data.model_name}</span>}{data.view_angle && <span>视角：{data.view_angle}</span>}{data.reference_count !== null && data.reference_count !== undefined && <span>参考：{data.reference_count} 张</span>}</Space>
    <Modal title="本图已保存的生成参数" open={expanded} onCancel={() => setExpanded(false)} footer={<Button aria-label="关闭" onClick={() => setExpanded(false)}>关闭</Button>}>
      <dl>{Object.entries(data.parameters ?? {}).map(([key, value]) => <div key={key}><dt>{labels[key] ?? key}</dt><dd style={{ whiteSpace: 'pre-wrap' }}>{value}</dd></div>)}</dl>
      {data.execution_prompt && <label>当时的提示词<Input.TextArea aria-label="历史提示词" readOnly value={data.execution_prompt} rows={10} /></label>}
    </Modal>
  </div>
}
