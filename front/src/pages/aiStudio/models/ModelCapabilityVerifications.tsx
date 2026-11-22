import { useEffect, useState } from 'react'
import { Alert, Button, Space, Spin, Tag } from 'antd'
import { LlmService } from '../../../services/generated'
import type { ModelCapabilityVerificationRead } from '../../../services/generated'
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

export function ModelCapabilityVerifications({ modelId, canVerify }: { modelId: string; canVerify: boolean }) {
  const [items, setItems] = useState<ModelCapabilityVerificationRead[]>([])
  const [loading, setLoading] = useState(true)
  const [pending, setPending] = useState<Capability>()
  const [error, setError] = useState('')
  const [retry, setRetry] = useState(0)

  useEffect(() => {
    let active = true
    const request = LlmService.getModelCapabilityVerificationsApiV1LlmModelsModelIdCapabilityVerificationsGet({ modelId })
    void request.then(result => {
      if (active) setItems(result.data ?? [])
    }).catch(() => {
      if (active) setError(uiText('读取验证历史失败'))
    }).finally(() => {
      if (active) setLoading(false)
    })
    return () => {
      active = false
      request.cancel()
    }
  }, [modelId, retry])

  const verify = async (capability: Capability) => {
    if (pending !== undefined) return
    setPending(capability)
    setError('')
    try {
      const result = await LlmService.verifyModelCapabilityApiV1LlmModelsModelIdCapabilityVerificationsPost({
        modelId,
        requestBody: { capability },
      })
      if (result.data) {
        const record = result.data
        setItems(previous => [record, ...previous])
      }
    } catch {
      setError(uiText('无法发起能力验证'))
    } finally {
      setPending(undefined)
    }
  }

  return (
    <div className="w-full min-w-0 space-y-3">
      {canVerify && <>
        <p className="text-xs text-slate-600">{uiText('验证会向已保存的模型发送一次测试，工具调用需要两轮请求。')}</p>
        <Space size={[8, 8]} wrap>
          {CHECKS.map(capability => (
            <Button key={capability} size="small" disabled={loading || (pending !== undefined && pending !== capability)}
              loading={pending === capability} onClick={() => void verify(capability)}>
              {uiText('验证{{capability}}', { capability: uiText(CAPABILITIES[capability]) })}
            </Button>
          ))}
        </Space>
      </>}
      {error && (
        <Alert type="error" showIcon message={error} action={(
          <Button size="small" onClick={() => {
            setError('')
            setLoading(true)
            setRetry(previous => previous + 1)
          }}>{uiText('重新读取')}</Button>
        )} />
      )}
      {loading && <Spin size="small" />}
      {!loading && items.length === 0 && !error && <p className="text-xs">{uiText('暂无模型能力验证记录')}</p>}
      {items.length > 0 && <ol className="space-y-3" aria-label={uiText('模型能力验证历史')}>
        {items.map(record => (
          <li key={record.id} className="break-all border-b pb-2">
            <div className="flex flex-wrap items-center gap-1">
              <span className="font-medium">{uiText(CAPABILITIES[record.capability])}</span>
              <Tag color={record.outcome === 'passed' ? 'green' : 'orange'}>{uiText(RESULTS[record.reason])}</Tag>
              <Tag>{uiText(record.current ? '当前配置' : '历史配置')}</Tag>
            </div>
            <div className="text-xs">{record.provider_name}</div>
            <div className="text-xs">{record.model_name}</div>
            {record.endpoint && <div className="text-xs">{record.endpoint}</div>}
            <time className="text-xs" dateTime={record.tested_at}>{new Date(record.tested_at).toLocaleString()}</time>
          </li>
        ))}
      </ol>}
    </div>
  )
}
