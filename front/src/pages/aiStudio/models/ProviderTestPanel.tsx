import { useEffect, useId, useRef, useState } from 'react'
import { Alert, AutoComplete, Button, ConfigProvider, Descriptions, Flex, Form, Input, Modal, Popover, Select, Tooltip, Typography, theme } from 'antd'
import { CheckCircleOutlined, ExclamationCircleOutlined, InfoCircleOutlined } from '@ant-design/icons'
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

type TestSelection = { model: string; category?: ModelCategoryKey }

function readSelection(key: string, available: ModelCategoryKey[]): TestSelection {
  const fallback = available.length === 1 ? available[0] : undefined
  try {
    const saved = JSON.parse(localStorage.getItem(key) ?? 'null')
    return {
      model: typeof saved?.model === 'string' ? saved.model : '',
      category: available.includes(saved?.category) ? saved.category : fallback,
    }
  } catch {
    return { model: '', category: fallback }
  }
}

export function ProviderTestPanel({ provider, spec, endpointLabel, desktop, busy, onSubmitting, onClose }: {
  provider: ProviderRead
  spec: ProviderSupportedRead
  endpointLabel: (url?: string | null) => string
  desktop: boolean
  busy: boolean
  onSubmitting: (busy: boolean) => void
  onClose: (restoreFocus: boolean) => void
}) {
  const available = Object.keys(spec.test_prompts ?? {}) as ModelCategoryKey[]
  const storageKey = `jellyfish_provider_test_selection:${provider.id}`
  const [{ model, category }, setSelection] = useState(() => readSelection(storageKey, available))
  const [options, setOptions] = useState<{ value: string }[]>([])
  const [catalogFailed, setCatalogFailed] = useState(false)
  const [result, setResult] = useState<ProviderTestResult>()
  const [failure, setFailure] = useState('')
  const { token } = theme.useToken()
  const id = useId()
  const panel = useRef<HTMLDivElement>(null)
  const [confirming, setConfirming] = useState(false)
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

  useEffect(() => {
    const field = confirming ? 'button' : 'input'
    panel.current?.querySelector<HTMLElement>(field)?.focus({ preventScroll: true })
  }, [confirming, desktop])

  async function submit() {
    if (!confirming || busy || inFlight.current || !model.trim() || !category) return
    setConfirming(false)
    inFlight.current = true
    onSubmitting(true)
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
      onSubmitting(false)
    }
  }

  const override = category === 'image' ? provider.image_base_url : category === 'video' ? provider.video_base_url : ''
  const title = uiText(confirming ? '确认付费测试？' : '测试调用')
  const cancel = () => {
    if (busy || inFlight.current) return
    if (confirming) setConfirming(false)
    else onClose(true)
  }
  const popupHost = (node: HTMLElement) => node.parentElement ?? node
  const changeSelection = (selection: TestSelection) => {
    setSelection(selection)
    try {
      localStorage.setItem(storageKey, JSON.stringify(selection))
    } catch {
      // 浏览器禁用存储时，仍可在当前面板完成测试。
    }
    setResult(undefined)
    setFailure('')
  }
  const detailItems = category ? [
    { key: 'type', label: uiText('调用类型'), children: uiText(categories[category]) },
    { key: 'endpoint', label: uiText('调用地址'), children: endpointLabel(override || provider.base_url || spec.default_base_url) },
    { key: 'prompt', label: uiText('测试文本'), children: spec.test_prompts?.[category] },
  ] : []
  const success = result?.outcome === 'success' || result?.outcome === 'accepted'
  const catalogHint = catalogFailed ? uiText('获取模型列表失败，可手动输入。') : ''
  const resultText = result ? uiText(messages[result.outcome]) : failure ? uiText(failure) : ''
  const statusText = [resultText, result?.http_status && `HTTP ${result.http_status}`].filter(Boolean).join(' · ')
  const body = <div ref={panel} id={id} role={desktop ? 'dialog' : undefined} aria-label={desktop ? title : undefined}
    style={{ overflowWrap: 'anywhere' }}
    onKeyDown={event => {
      if (event.key === 'Escape' && !event.nativeEvent.isComposing && !panel.current?.querySelector('[aria-expanded="true"]')) {
        event.stopPropagation()
        cancel()
      }
    }}>
    {confirming ? <Flex vertical gap={desktop ? 6 : 12}>
      <Descriptions size="small" column={1} items={[
        { key: 'config', label: uiText('配置名称'), children: provider.name },
        { key: 'model', label: uiText('远端模型'), children: model.trim() },
      ]} />
      <Alert type="warning" showIcon message={uiText('本次测试会向供应商发起真实调用，可能产生费用。')} />
    </Flex> : <Flex vertical gap={desktop ? 6 : 12}>
      <Form layout={desktop ? 'horizontal' : 'vertical'} size={desktop ? 'small' : 'middle'} colon={false}
        labelCol={desktop ? { flex: '64px' } : undefined} wrapperCol={desktop ? { flex: 1 } : undefined} labelAlign="left">
        <Form.Item label={uiText('远端模型')} htmlFor={id + '-model'} style={{ marginBottom: desktop ? (available.length > 1 ? 6 : 0) : 12 }}
          help={!desktop && catalogHint ? catalogHint : undefined}>
          {spec.live_model_catalog
            ? <AutoComplete id={id + '-model'} value={model} options={options} disabled={busy} getPopupContainer={popupHost}
              filterOption={(value, option) => !!option?.value.toLowerCase().includes(value.toLowerCase())}
              placeholder={uiText('选择或输入模型名称')} onChange={value => changeSelection({ model: value, category })} />
            : <Input id={id + '-model'} value={model} disabled={busy} placeholder={uiText('输入模型名称')}
              onChange={event => changeSelection({ model: event.target.value, category })} />}
        </Form.Item>
        {available.length === 1 && category
          ? !desktop && <Typography.Text type="secondary">{uiText('调用类型')} · {uiText(categories[category])}</Typography.Text>
          : <Form.Item label={uiText('调用类型')} htmlFor={id + '-category'} style={{ marginBottom: 0 }}>
            <Select id={id + '-category'} value={category} disabled={busy} getPopupContainer={popupHost}
              placeholder={uiText('选择调用类型')} onChange={value => changeSelection({ model, category: value })}
              options={available.map(value => ({ value, label: uiText(categories[value]) }))} />
          </Form.Item>}
      </Form>
      {!desktop && category && <details>
        <summary style={{ cursor: 'pointer' }}>{uiText('调用详情')}</summary>
        <Descriptions size="small" column={1} style={{ marginTop: 8 }} items={detailItems.slice(1)} />
      </details>}
      {!desktop && resultText && <div role="status"><Alert showIcon type={success ? 'success' : 'warning'}
        message={resultText} description={result?.http_status ? `HTTP ${result.http_status}` : undefined} /></div>}
    </Flex>}
    <Flex align="center" justify="end" gap={desktop ? 4 : 8} style={{ marginTop: desktop ? 8 : 16 }}>
      {desktop && !confirming && <Flex align="center" gap={2} style={{ marginRight: 'auto' }}>
        {!!detailItems.length && <Tooltip trigger={['hover', 'focus', 'click']} title={detailItems.map(item =>
          <div key={item.key} style={{ overflowWrap: 'anywhere' }}>{item.label} · {item.children}</div>)}>
          <Button type="text" size="small" aria-label={uiText('调用详情')} icon={<InfoCircleOutlined />} />
        </Tooltip>}
        {statusText && <span role="status"><Tooltip trigger={['hover', 'focus', 'click']} title={statusText}>
          <Button type="text" size="small" aria-label={statusText}
            icon={success ? <CheckCircleOutlined style={{ color: token.colorSuccess }} />
              : <ExclamationCircleOutlined style={{ color: token.colorWarning }} />} />
        </Tooltip></span>}
        {catalogFailed && <Typography.Text type="secondary" role="status" title={catalogHint}>
          {uiText('列表不可用，请手填')}
        </Typography.Text>}
      </Flex>}
      <Button onClick={cancel} disabled={busy}>{uiText(confirming ? '返回' : '关闭')}</Button>
      <Button type="primary" loading={busy} disabled={!model.trim() || !category}
        onClick={() => confirming ? void submit() : setConfirming(true)}>{uiText(confirming ? '确认测试' : '测试')}</Button>
    </Flex>
  </div>
  const trigger = <Button type="text" size="small" aria-haspopup="dialog" aria-expanded aria-controls={id}>{uiText('测试调用')}</Button>
  if (desktop) return <Popover open trigger="click" placement="bottomRight" content={
    <ConfigProvider componentSize="small" theme={{ token: { fontSize: 12 } }}>{body}</ConfigProvider>
  }
    overlayStyle={{ width: 280 }} onOpenChange={open => { if (!open && !busy && !inFlight.current) onClose(false) }}>
    {trigger}
  </Popover>
  return <>{trigger}<Modal open title={title} width={400} footer={null} closable={!busy}
    keyboard={!busy} maskClosable={!busy && !confirming} onCancel={cancel}>{body}</Modal></>
}
