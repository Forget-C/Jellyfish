import { currentLanguage } from '../../../../i18n'
import { useUiText } from '../../../../uiText'
import { useEffect, useState } from 'react'
import { Alert, Button, Input, Modal, Skeleton, Space } from 'antd'
import { FilmService, type ActorImageParametersRead } from '../../../../services/generated'

const labels: Record<string, string> = { framing_instruction: '构图', background_instruction: '背景', lighting_instruction: '灯光', visible_detail_instruction: '细节强调', negative_prompt: '排除内容', additional_instruction: '附加要求', edit_instruction: '修改要求', preserve_instruction: '保持内容' }

/** 只展示当前图片对应的已保存快照；切图卸载后丢弃旧响应，不拿当前配置补全历史。 */
export function AssetImageParameters({ type, assetId, imageId }: { type: string; assetId: string; imageId: number }) {
  const uiText = useUiText()
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
  if (failed) return <div className="actor-image-parameters"><Alert type="error" message={uiText("读取本图生成记录失败")} action={<Button onClick={() => setRetry(value => value + 1)}>{uiText("重试记录")}</Button>} /></div>
  if (data === undefined) return <div className="actor-image-parameters" role="status" aria-label={uiText("正在读取生成记录")}><Skeleton active title={false} paragraph={{ rows: 2, width: ['65%', '45%'] }} /></div>
  if (data === null) return <div className="actor-image-parameters actor-image-parameters-empty" aria-label={uiText("暂无本图生成记录")}>{uiText("暂无生成记录")}</div>
  return <div className="actor-image-parameters">
    <Space wrap><strong>{uiText("本图生成记录")}</strong><span>{new Date(data.created_at_ts * 1000).toLocaleString(currentLanguage())}</span>{(data.execution_prompt || Object.keys(data.parameters ?? {}).length > 0) && <Button type="link" onClick={() => setExpanded(true)}>{uiText("查看参数")}</Button>}</Space>
    <Space wrap>{data.model_name && <span>{uiText("模型：")}{data.model_name}</span>}{data.view_angle && <span>{uiText("视角：")}{data.view_angle}</span>}{data.reference_count !== null && data.reference_count !== undefined && <span>{uiText("参考：")}{data.reference_count} {uiText("张")}</span>}</Space>
    <Modal title={uiText("本图已保存的生成参数")} open={expanded} onCancel={() => setExpanded(false)} footer={<Button aria-label={uiText("关闭")} onClick={() => setExpanded(false)}>{uiText("关闭")}</Button>}>
      <dl>{Object.entries(data.parameters ?? {}).map(([key, value]) => <div key={key}><dt>{labels[key] ?? key}</dt><dd style={{ whiteSpace: 'pre-wrap' }}>{value}</dd></div>)}</dl>
      {data.execution_prompt && <label>{uiText("当时的提示词")}<Input.TextArea aria-label={uiText("历史提示词")} readOnly value={data.execution_prompt} rows={10} /></label>}
    </Modal>
  </div>
}
