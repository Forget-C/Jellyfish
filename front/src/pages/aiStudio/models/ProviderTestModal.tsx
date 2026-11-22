import { useEffect, useRef, useState } from 'react'
import { Alert, AutoComplete, Col, Descriptions, Form, Input, Modal, Row, Select, theme } from 'antd'
import { LlmService } from '../../../services/generated/services/LlmService'
import { ApiError } from '../../../services/generated'
import type { ModelCategoryKey, ProviderRead, ProviderSupportedRead, ProviderTestResult } from '../../../services/generated'
import { uiText } from '../../../uiText'

const categories = { text: '文本', image: '图片', video: '视频' }
const messages: Record<ProviderTestResult['outcome'], string> = {
  success: '调用成功，已收到有效输出。',
  accepted: '供应商已受理任务，提交权限验证成功。',
  unauthorized: '凭据无效，请检查 API Key。',
  forbidden: '该凭据没有调用所选模型的权限。',
  limited: '供应商限制了调用，请检查额度、余额或频率限制。',
  rejected: '供应商拒绝了请求，请检查模型名称、类型和参数。',
  remote_error: '供应商服务发生错误，暂时无法验证。',
  unverified: '供应商响应无法确认调用结果，再次测试可能重复计费。',
  unknown: '未能确认供应商是否受理，再次测试可能重复计费。',
}

export function ProviderTestModal({ provider, spec, endpointLabel, onClose }: {
  provider: ProviderRead
  spec: ProviderSupportedRead
  endpointLabel: (url?: string | null) => string
  onClose: () => void
}) {
  const [model, setModel] = useState('')
  const available = Object.keys(spec.test_prompts ?? {}) as ModelCategoryKey[]
  const [category, setCategory] = useState<ModelCategoryKey | undefined>(available.length === 1 ? available[0] : undefined)
  const [options, setOptions] = useState<{ value: string }[]>([])
  const [catalogFailed, setCatalogFailed] = useState(false)
  const [result, setResult] = useState<ProviderTestResult>()
  const [failure, setFailure] = useState('')
  const { token } = theme.useToken()
  const [confirming, setConfirming] = useState(false)
  const [busy, setBusy] = useState(false)
  const inFlight = useRef(false)

  useEffect(() => {
    if (!spec.live_model_catalog) return
    let active = true
    const request = LlmService.getProviderModelCatalogApiV1LlmProvidersProviderIdModelsCatalogGet({ providerId: provider.id })
    void request.then(response => {
      if (active) setOptions((response.data?.models ?? []).map(item => ({ value: item.name })))
    }).catch(() => { if (active) setCatalogFailed(true) })
    return () => { active = false; request.cancel() }
  }, [provider.id, spec.live_model_catalog])

  async function submit() {
    if (inFlight.current || !model.trim() || !category) return
    setConfirming(false)
    inFlight.current = true
    setBusy(true)
    setResult(undefined)
    setFailure('')
    try {
      const response = await LlmService.testProviderCallApiV1LlmProvidersProviderIdTestCallPost({
        providerId: provider.id, requestBody: { category, model: model.trim() },
      })
      setResult(response.data ?? { outcome: 'unknown' })
    } catch (error) {
      const detail = error instanceof ApiError ? String(error.body?.message ?? '') : ''
      if (detail.startsWith('Provider api_key is empty')) setFailure('请先为此配置填写 API Key')
      else if (detail.startsWith('Provider api_secret is empty')) setFailure('请先为此配置填写 API Secret')
      else if (detail.startsWith('Provider is disabled')) setFailure('供应商配置已禁用')
      else if (error instanceof ApiError && [400, 404, 422].includes(error.status)) setFailure('请检查供应商配置、模型名称和调用类型，本次未提交。')
      else setFailure('测试请求未完成，请检查供应商配置和网络。再次测试可能重复计费。')
    } finally {
      inFlight.current = false
      setBusy(false)
    }
  }

  const override = category === 'image' ? provider.image_base_url : category === 'video' ? provider.video_base_url : ''
  return <>
    <Modal open width={560} title={uiText('测试调用')} cancelText={uiText('关闭')} okText={uiText('测试')}
      closable={!busy} keyboard={!busy} cancelButtonProps={{ disabled: busy }}
      onCancel={() => {
        if (confirming) setConfirming(false)
        else if (!inFlight.current) onClose()
      }} onOk={() => setConfirming(true)} confirmLoading={busy}
      okButtonProps={{ disabled: !category || !model.trim() }} maskClosable={!busy && !confirming}>
      <Form layout="vertical" className="pt-2">
        <Row gutter={16}>
          <Col xs={24} sm={16}>
            <Form.Item label={uiText('远端模型')} htmlFor="probe-model" help={catalogFailed ? uiText('获取模型列表失败，可手动输入。') : undefined}>
              {spec.live_model_catalog
                ? <AutoComplete id="probe-model" value={model} options={options} disabled={busy}
                  filterOption={(value, option) => !!option?.value.toLowerCase().includes(value.toLowerCase())}
                  placeholder={uiText('选择或输入模型名称')} onChange={value => { setModel(value); setResult(undefined); setFailure('') }} />
                : <Input id="probe-model" value={model} disabled={busy} placeholder={uiText('输入模型名称')}
                  onChange={event => { setModel(event.target.value); setResult(undefined); setFailure('') }} />}
            </Form.Item>
          </Col>
          <Col xs={24} sm={8}>
            <Form.Item label={uiText('调用类型')} htmlFor="probe-category">
              <Select id="probe-category" value={category} disabled={busy || available.length === 1}
                placeholder={uiText('选择调用类型')} onChange={value => { setCategory(value); setResult(undefined); setFailure('') }}
                options={available.map(value => ({ value, label: uiText(categories[value]) }))} />
            </Form.Item>
          </Col>
        </Row>
        <Descriptions size="small" column={1} colon={false}
          style={{ background: token.colorFillQuaternary, borderRadius: token.borderRadiusLG, padding: token.paddingSM }}
          contentStyle={{ overflowWrap: 'anywhere' }}
          items={[
            { key: 'config', label: uiText('配置名称'), children: provider.name },
            ...(category ? [
              { key: 'endpoint', label: uiText('调用地址'), children: endpointLabel(override || provider.base_url || spec.default_base_url) },
              { key: 'prompt', label: uiText('测试文本'), children: spec.test_prompts?.[category] },
            ] : []),
          ]} />
        {(result || failure) && <div role="status" style={{ marginTop: token.marginSM }}><Alert showIcon
          type={result && ['success', 'accepted'].includes(result.outcome) ? 'success' : 'warning'}
          message={uiText(result ? messages[result.outcome] : failure)}
          description={result?.http_status ? `HTTP ${result.http_status}` : undefined} /></div>}
      </Form>
    </Modal>
    <Modal open={confirming} title={uiText('确认付费测试？')} width={400}
      okText={uiText('确认测试')} cancelText={uiText('取消')} cancelButtonProps={{ autoFocus: true }}
      onCancel={() => setConfirming(false)} onOk={() => void submit()} destroyOnClose>
      {uiText('本次测试会向供应商发起真实调用，可能产生费用。')}
    </Modal>
  </>
}
