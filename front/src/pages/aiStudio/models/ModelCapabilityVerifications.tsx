import { useEffect, useRef, useState } from 'react'
import { Button, Checkbox, Popover, Space, Tooltip } from 'antd'
import { LlmService } from '../../../services/generated'
import type { ModelCapabilityProfile_Input, ModelCapabilityVerificationRead } from '../../../services/generated'
import { uiText } from '../../../uiText'

const CAPABILITIES = {
  tool_calling: '工具调用',
  image_inputs: '图片输入',
  video_inputs: '连续视频输入',
  audio_inputs: '音频输入',
} as const
type Capability = keyof typeof CAPABILITIES
const CHECKS = Object.keys(CAPABILITIES) as Capability[]

const RESULTS = {
  verified: '验证通过',
  tool_not_called: '模型未发起有效的工具调用',
  tool_result_not_used: '模型未根据工具结果继续回答',
  expected_observation_missing: '未确认模型读取到该项内容',
  provider_unavailable: '当前供应商配置不可用',
  request_failed: '供应商请求失败',
  probe_unavailable: '无法准备本次验证素材',
} as const

export function useCapabilityTests(modelId?: string) {
  const activeModel = useRef(false)
  useEffect(() => {
    activeModel.current = true
    return () => { activeModel.current = false }
  }, [modelId])
  const [items, setItems] = useState<ModelCapabilityVerificationRead[]>([])
  const [pending, setPending] = useState<Capability>()
  const [historyError, setHistoryError] = useState(false)
  const [latestRequestFailed, setLatestRequestFailed] = useState({ input: false, tools: false })
  const [failed, setFailed] = useState<Capability[]>([])
  const [reload, setReload] = useState(0)
  useEffect(() => {
    if (!modelId) return
    let active = true
    const request = LlmService.getModelCapabilityVerificationsApiV1LlmModelsModelIdCapabilityVerificationsGet({ modelId })
    request.then(result => {
      if (active) {
        setItems(local => [...local, ...(result.data ?? []).filter(row => !local.some(item => item.id === row.id))])
        setHistoryError(false)
      }
    }).catch(() => { if (active) setHistoryError(true) })
    return () => { active = false; request.cancel() }
  }, [modelId, reload])

  async function run(queue: Capability[]) {
    if (!modelId || pending || !queue.length) return
    for (const capability of queue) {
      if (!activeModel.current) break
      const group = capability === 'tool_calling' ? 'tools' : 'input'
      setPending(capability)
      try {
        const { data } = await LlmService.verifyModelCapabilityApiV1LlmModelsModelIdCapabilityVerificationsPost({ modelId, requestBody: { capability } })
        if (!data) throw new Error()
        setItems(previous => [data, ...previous])
        setLatestRequestFailed(previous => ({ ...previous, [group]: false }))
        setFailed(previous => previous.filter(key => key !== capability))
      } catch {
        setLatestRequestFailed(previous => ({ ...previous, [group]: true }))
        setFailed(previous => [...new Set([...previous, capability])])
      }
    }
    setPending(undefined)
  }
  return { items, latestRequestFailed, failed, pending, historyError, reloadHistory: () => setReload(value => value + 1), run }
}

export function ModelCapabilityVerifications({ modelId, group, profile, tests }: {
  modelId?: string; group: 'input' | 'tools'; profile: ModelCapabilityProfile_Input; tests: ReturnType<typeof useCapabilityTests>
}) {
  const checks = CHECKS.filter(key => (key === 'tool_calling') === (group === 'tools'))
  const label = uiText(group === 'input' ? '测试输入模态' : '测试工具调用')
  const [selected, setSelected] = useState<Capability[]>([])
  const [open, setOpen] = useState(false)
  const panel = useRef<HTMLDivElement>(null)
  const { items, latestRequestFailed, failed, pending, historyError, reloadHistory, run } = tests
  const history = items.filter(item => checks.includes(item.capability))
  const runningHere = pending && checks.includes(pending)
  const content = <div ref={panel} className="model-cap-probe" role="group" aria-label={label} onKeyDown={event => {
    if (event.key === 'Escape') { event.stopPropagation(); setOpen(false); document.getElementById('probe-' + group)?.focus() }
  }}>
    <p className="model-cap-note">{uiText(group === 'input' ? '本次测试使用已保存的配置。' : '使用已保存的配置发送两轮请求，检查函数调用和工具结果回传。')}</p>
    {group === 'input' && <Checkbox.Group value={selected} disabled={!!pending} onChange={values => setSelected(values as Capability[])}
      options={checks.map(value => ({ value, label: uiText(CAPABILITIES[value]) }))} />}
    <Button size="small" disabled={!selected.length || !!pending} loading={!!runningHere} onClick={() => void run(selected)}>{runningHere && pending ? uiText(CAPABILITIES[pending]) : uiText('开始测试')}</Button>
    <div aria-live="polite">{checks.map(key => {
      const record = history.find(item => item.capability === key)
      if (!record && !failed.includes(key)) return null
      return <div key={key}>{uiText(CAPABILITIES[key])} · {uiText(failed.includes(key) ? '无法发起能力验证' : RESULTS[record!.reason])}
        {(failed.includes(key) || record?.outcome === 'failed') && <Button type="link" size="small" disabled={!!pending} onClick={() => void run([key])}>{uiText('重试')}</Button>}
      </div>
    })}</div>
    {historyError && <Button size="small" onClick={reloadHistory}>{uiText('重新读取验证历史')}</Button>}
    {history.length > 0 && <details><summary>{uiText('验证历史')}</summary><ol>{history.map(item => <li key={item.id}>{uiText(CAPABILITIES[item.capability])} · {uiText(RESULTS[item.reason])}
      <div>{item.model_name} · {item.provider_name} · {uiText(item.current ? '当前配置' : '历史配置')}</div>
      <div className="model-cap-note break-all">{item.endpoint} · {new Date(item.tested_at).toLocaleString()}</div></li>)}</ol></details>}
  </div>
  if (!modelId) return <span className="model-cap-note">{uiText('保存模型后可测试')}</span>
  return <Space orientation="vertical" size={0} align="end">
    <Popover afterOpenChange={visible => { if (visible) panel.current?.querySelector<HTMLElement>('input:enabled, button:enabled')?.focus() }} trigger="click" placement="bottomRight" open={open} onOpenChange={next => {
      if (next && !runningHere) setSelected(checks.filter(key => group === 'tools' || profile[key]))
      setOpen(next)
    }} content={content}><Button id={'probe-' + group} type="link" size="small" aria-label={label} aria-expanded={open}>{uiText('测试…')}</Button></Popover>
    {latestRequestFailed[group] ? <span className="model-cap-note">{uiText('无法发起能力验证')}</span> : history[0] && <Tooltip title={uiText(RESULTS[history[0].reason])}><span className="model-cap-note">{uiText(history[0].outcome === 'passed' ? '最近测试通过' : '最近测试未通过')}</span></Tooltip>}
  </Space>
}
