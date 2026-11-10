import type { ReactNode } from 'react'
import { useEffect, useMemo, useRef, useState } from 'react'
import {
  Alert,
  Button,
  Descriptions,
  Drawer,
  Dropdown,
  Empty,
  Form,
  Input,
  Modal,
  Select,
  Skeleton,
  Space,
  Table,
  Tag,
  message,
} from 'antd'
import type { TableColumnsType } from 'antd'
import { DeleteOutlined, DownOutlined, MoreOutlined, PlusOutlined, SearchOutlined } from '@ant-design/icons'
import { PageToolbar, WorkspaceScrollPanel } from '../../../components'
import { LlmService } from '../../../services/generated/services/LlmService'
import type { ProviderRead, ProviderSupportedRead } from '../../../services/generated'
import { PROVIDER_STATUS_MAP, SORT_OPTIONS, maskUrl } from './constants'

const PAGE_SIZE = 20

/** 详情展示端点地址，URL 中可能携带的身份与查询凭据不参与展示。 */
function endpointLabel(value?: string | null) {
  if (!value) return '—'
  try {
    const url = new URL(value)
    return `${url.protocol}//${url.host}${url.pathname}`
  } catch {
    return '未知'
  }
}

export default function ProvidersTab({ header }: { header: ReactNode }) {
  const [result, setResult] = useState<{ providers: ProviderRead[]; total?: number } | null>(null)
  const [loading, setLoading] = useState(true)
  const [loadFailed, setLoadFailed] = useState(false)
  const [revision, setRevision] = useState(0)
  const [search, setSearch] = useState('')
  const [sortBy, setSortBy] = useState<'updated' | 'name'>('updated')
  const [page, setPage] = useState(1)
  const [supportedSpecs, setSupportedSpecs] = useState<ProviderSupportedRead[]>([])
  const [supportedLoading, setSupportedLoading] = useState(true)
  const [selectedProvider, setSelectedProvider] = useState<ProviderRead | null>(null)
  const [detailPanelOpen, setDetailPanelOpen] = useState(false)
  const detailTrigger = useRef<HTMLElement | null>(null)
  const [providerModalOpen, setProviderModalOpen] = useState(false)
  const [providerEditing, setProviderEditing] = useState<ProviderRead | null>(null)
  const [credentialsLoading, setCredentialsLoading] = useState(false)
  const credentialsRequest = useRef<ReturnType<typeof LlmService.getProviderCredentialsApiV1LlmProvidersProviderIdCredentialsGet> | null>(null)
  const [saving, setSaving] = useState(false)
  const saveInFlight = useRef(false)
  const deleteInFlight = useRef(false)
  const [confirmingDelete, setConfirmingDelete] = useState(false)
  const [modal, modalContext] = Modal.useModal()
  const [form] = Form.useForm()

  const reload = () => setRevision(value => value + 1)

  useEffect(() => {
    let active = true
    setLoading(true)
    setLoadFailed(false)
    const request = LlmService.listProvidersApiV1LlmProvidersGet({
      q: search.trim() || undefined,
      order: sortBy === 'name' ? 'name' : 'updated_at',
      isDesc: sortBy !== 'name',
      page,
      pageSize: PAGE_SIZE,
    })
    void request.then(response => {
      if (!active) return
      const data = response.data
      if (!data || !Array.isArray(data.items)) {
        setLoadFailed(true)
        return
      }
      setResult({
        providers: data.items,
        total: typeof data.pagination?.total === 'number' ? data.pagination.total : undefined,
      })
    }).catch(() => {
      if (active) setLoadFailed(true)
    }).finally(() => {
      if (active) setLoading(false)
    })
    return () => {
      active = false
      request.cancel()
    }
  }, [page, revision, search, sortBy])

  useEffect(() => {
    let active = true
    const request = LlmService.listSupportedProvidersApiV1LlmProvidersSupportedGet({})
    void request.then(response => {
      if (active) setSupportedSpecs(response.data ?? [])
    }).catch(() => {
      if (active) message.error('加载系统支持的供应商列表失败')
    }).finally(() => {
      if (active) setSupportedLoading(false)
    })
    return () => {
      active = false
      request.cancel()
    }
  }, [])

  useEffect(() => () => credentialsRequest.current?.cancel(), [])

  const providerNameOptions = useMemo(() => {
    const fromApi = supportedSpecs.map(spec => ({
      label: spec.is_experimental ? `${spec.display_name}（实验）` : spec.display_name,
      value: spec.display_name,
    }))
    const name = providerEditing?.name?.trim()
    if (!name || supportedSpecs.some(spec => spec.display_name === name || spec.aliases?.includes(name))) return fromApi
    return [{ label: `${name}（历史/未在清单内）`, value: name }, ...fromApi]
  }, [supportedSpecs, providerEditing])

  const applyDefaultBaseUrlForDisplayName = (displayName: string) => {
    const spec = supportedSpecs.find(item => item.display_name === displayName || item.aliases?.includes(displayName))
    const defaultUrl = spec?.default_base_url?.trim()
    if (!defaultUrl) return
    const current = (form.getFieldValue('base_url') as string | undefined)?.trim()
    if (!providerEditing || !current) form.setFieldsValue({ base_url: defaultUrl })
  }

  const closeProviderModal = () => {
    credentialsRequest.current?.cancel()
    credentialsRequest.current = null
    setCredentialsLoading(false)
    setProviderModalOpen(false)
    setProviderEditing(null)
    form.resetFields()
  }

  const handleSaveProvider = async () => {
    if (saveInFlight.current || credentialsLoading) return
    saveInFlight.current = true
    setSaving(true)
    try {
      const values = await form.validateFields()
      const sharedFields = {
        name: values.name,
        base_url: values.base_url,
        image_base_url: values.image_base_url ?? null,
        video_base_url: values.video_base_url ?? null,
        description: values.description ?? null,
        status: values.status ?? null,
      }
      if (providerEditing) {
        const requestBody: Parameters<typeof LlmService.updateProviderApiV1LlmProvidersProviderIdPatch>[0]['requestBody'] = sharedFields
        if (values.api_key && values.api_key !== '********') requestBody.api_key = values.api_key
        if (values.api_secret && values.api_secret !== '********') requestBody.api_secret = values.api_secret
        await LlmService.updateProviderApiV1LlmProvidersProviderIdPatch({ providerId: providerEditing.id, requestBody })
        message.success('供应商已更新')
      } else {
        const id = typeof crypto !== 'undefined' && crypto.randomUUID
          ? crypto.randomUUID()
          : `prov_${Date.now()}_${Math.random().toString(36).slice(2, 11)}`
        await LlmService.createProviderApiV1LlmProvidersPost({
          requestBody: {
            ...sharedFields,
            id,
            description: values.description,
            status: values.status,
            api_key: values.api_key,
            api_secret: values.api_secret,
          },
        })
        message.success('供应商已添加')
      }
      closeProviderModal()
      reload()
    } catch (error) {
      if (error && typeof error === 'object' && 'errorFields' in error) return
      message.error('保存供应商失败，请重试')
    } finally {
      saveInFlight.current = false
      setSaving(false)
    }
  }

  const handleDeleteProvider = async (provider: ProviderRead) => {
    if (deleteInFlight.current) return
    deleteInFlight.current = true
    setConfirmingDelete(true)
    let linked: number | undefined
    try {
      const response = await LlmService.listModelsApiV1LlmModelsGet({ providerId: provider.id, pageSize: 1 })
      linked = response.data?.pagination?.total
    } catch {
      // 数量不可用时仍由既有删除接口校验关联限制。
    }
    try {
      await modal.confirm({
        title: `删除供应商「${provider.name}」？`,
        content: linked === 0 ? '删除后无法恢复。' : linked === undefined
          ? '未能读取关联模型数量。删除后，关联模型可能失效。'
          : `该供应商关联 ${linked} 个模型，删除后关联模型可能失效。`,
        okText: '删除',
        okType: 'danger',
        onOk: async () => {
          try {
            await LlmService.deleteProviderApiV1LlmProvidersProviderIdDelete({ providerId: provider.id })
            message.success('供应商已删除')
            if (result?.providers.length === 1 && page > 1) setPage(page - 1)
            else reload()
          } catch (error) {
            message.error('删除供应商失败，请重试')
            throw error
          }
        },
      })
    } finally {
      deleteInFlight.current = false
      setConfirmingDelete(false)
    }
  }

  /** 真实凭据仅通过原编辑流程读取，列表和只读详情不请求凭据。 */
  const openProviderModal = async (provider?: ProviderRead) => {
    setProviderEditing(provider ?? null)
    form.resetFields()
    setProviderModalOpen(true)
    if (!provider) return
    form.setFieldsValue({
      name: provider.name,
      base_url: provider.base_url,
      image_base_url: provider.image_base_url,
      video_base_url: provider.video_base_url,
      description: provider.description,
      status: provider.status ?? 'active',
    })
    setCredentialsLoading(true)
    const request = LlmService.getProviderCredentialsApiV1LlmProvidersProviderIdCredentialsGet({ providerId: provider.id })
    credentialsRequest.current = request
    try {
      const response = await request
      if (credentialsRequest.current === request) {
        form.setFieldsValue({ api_key: response.data?.api_key ?? '', api_secret: response.data?.api_secret ?? '' })
      }
    } catch {
      if (credentialsRequest.current === request) message.error('加载供应商密钥失败，可留空或重新填写后保存')
    } finally {
      if (credentialsRequest.current === request) {
        credentialsRequest.current = null
        setCredentialsLoading(false)
      }
    }
  }

  const changeSearch = (value: string) => {
    setSearch(value)
    setPage(1)
  }

  const providerColumns: TableColumnsType<ProviderRead> = [
    {
      title: '名称', dataIndex: 'name', key: 'name', width: 180,
      render: (name: string, record) => (
        <Button type="link" className="management-name" title={name} onClick={event => {
          detailTrigger.current = event.currentTarget
          setSelectedProvider(record)
          setDetailPanelOpen(true)
        }}>{name}</Button>
      ),
    },
    {
      title: '地址摘要', dataIndex: 'base_url', key: 'base_url', ellipsis: true,
      render: (url: string) => {
        const address = endpointLabel(url)
        return address === '未知' || address === '—' ? address : maskUrl(address)
      },
    },
    { title: '凭据配置状态', key: 'credentials', width: 132, render: () => '未知' },
    {
      title: '状态', dataIndex: 'status', key: 'status', width: 90,
      render: (status: ProviderRead['status']) => status
        ? <Tag color={PROVIDER_STATUS_MAP[status]?.color}>{PROVIDER_STATUS_MAP[status]?.text ?? '未知'}</Tag>
        : '未知',
    },
    {
      title: '操作', key: 'action', width: 224,
      render: (_, record) => (
        <Space size={4}>
          <Button type="text" size="small" aria-label={`编辑 ${record.name}`} onClick={() => void openProviderModal(record)}>编辑</Button>
          <Button type="text" size="small" disabled>测试（暂未接入）</Button>
          <Dropdown trigger={['click']} menu={{ items: [{
            key: 'delete', label: '删除', danger: true, icon: <DeleteOutlined />,
            disabled: confirmingDelete,
            onClick: () => void handleDeleteProvider(record),
          }] }}>
            <Button type="text" size="small" icon={<MoreOutlined />} aria-label={`${record.name}的更多操作`} />
          </Dropdown>
        </Space>
      ),
    },
  ]

  return (
    <>
      {header}
      <PageToolbar className="management-toolbar">
        <div className="management-tools">
          <Input
            aria-label="搜索供应商"
            prefix={<SearchOutlined />}
            placeholder="搜索名称或描述"
            allowClear
            value={search}
            onChange={event => changeSearch(event.target.value)}
          />
          <Dropdown
            trigger={['click']}
            menu={{
              selectable: true,
              selectedKeys: [sortBy],
              items: SORT_OPTIONS.filter(option => option.value !== 'category').map(option => ({
                key: option.value, label: option.label,
                onClick: () => {
                  setSortBy(option.value as 'updated' | 'name')
                  setPage(1)
                },
              })),
            }}
          >
            <Button icon={<DownOutlined />}>排序：{SORT_OPTIONS.find(option => option.value === sortBy)?.label}</Button>
          </Dropdown>
          {result && <span className="management-count">
            {result.total === undefined ? `已加载 ${result.providers.length} 个供应商` : `共 ${result.total} 个供应商`}
          </span>}
        </div>
        <Button className="management-primary" type="primary" icon={<PlusOutlined />} onClick={() => void openProviderModal()}>
          添加供应商
        </Button>
      </PageToolbar>
      <WorkspaceScrollPanel className="management-panel">
        {loadFailed && <Alert
          showIcon
          type="error"
          message={result ? '刷新供应商失败，仍显示上次结果' : '加载供应商失败'}
          action={<Button size="small" onClick={reload}>重试</Button>}
        />}
        {loading && !result && <div className="management-surface" role="status" aria-label="正在加载供应商">
          <Skeleton active paragraph={{ rows: 4 }} />
        </div>}
        {result && <div className="management-surface">
          <Table<ProviderRead>
            className="management-table"
            rowKey="id"
            loading={loading}
            columns={providerColumns}
            dataSource={result.providers}
            scroll={{ x: 790 }}
            pagination={result.total === undefined ? false : { current: page, pageSize: PAGE_SIZE, total: result.total, showSizeChanger: false, hideOnSinglePage: true, onChange: setPage }}
            locale={{
              emptyText: loadFailed || loading ? null : (
                <Empty description={search.trim() ? '无匹配结果' : '暂无供应商'}>
                  {search.trim()
                    ? <Button onClick={() => changeSearch('')}>清除搜索</Button>
                    : <Button onClick={() => void openProviderModal()}>添加第一个供应商</Button>}
                </Empty>
              ),
            }}
            size="small"
          />
        </div>}
      </WorkspaceScrollPanel>

      <Drawer
        title="供应商详情"
        aria-label="供应商详情"
        open={detailPanelOpen}
        placement="right"
        width="min(100vw, 420px)"
        onClose={() => setDetailPanelOpen(false)}
        afterOpenChange={open => {
          if (!open) {
            setSelectedProvider(null)
            requestAnimationFrame(() => detailTrigger.current?.focus({ preventScroll: true }))
          }
        }}
      >
        {selectedProvider && <Descriptions className="management-details" column={1} layout="vertical" size="small" items={[
          { key: 'name', label: '名称', children: selectedProvider.name },
          { key: 'url', label: '文本/通用 Base URL', children: endpointLabel(selectedProvider.base_url) },
          { key: 'image', label: '图片 Base URL', children: selectedProvider.image_base_url ? endpointLabel(selectedProvider.image_base_url) : '回退到文本/通用' },
          { key: 'video', label: '视频 Base URL', children: selectedProvider.video_base_url ? endpointLabel(selectedProvider.video_base_url) : '回退到文本/通用' },
          { key: 'credentials', label: '凭据配置状态', children: '未知' },
          { key: 'status', label: '状态', children: selectedProvider.status ? PROVIDER_STATUS_MAP[selectedProvider.status]?.text ?? '未知' : '未知' },
          { key: 'description', label: '描述', children: selectedProvider.description || '—' },
          { key: 'created', label: '创建人', children: selectedProvider.created_by || '—' },
        ]} />}
      </Drawer>

      {modalContext}
      <Modal
        title={providerEditing ? '编辑供应商' : '添加供应商'}
        open={providerModalOpen}
        onCancel={() => { if (!saving) closeProviderModal() }}
        onOk={() => void handleSaveProvider()}
        confirmLoading={saving}
        okButtonProps={{ disabled: credentialsLoading }}
        cancelButtonProps={{ disabled: saving }}
        width={560}
        destroyOnClose
      >
        <Form form={form} layout="vertical" className="pt-2">
          <Form.Item name="name" label="名称" rules={[{ required: true, message: '请选择供应商' }]}>
            <Select
              showSearch
              optionFilterProp="label"
              loading={supportedLoading}
              placeholder={supportedLoading ? '加载供应商清单…' : '选择供应商'}
              options={providerNameOptions}
              notFoundContent={supportedLoading ? '加载中…' : '暂无数据'}
              onChange={(v) => applyDefaultBaseUrlForDisplayName(String(v))}
            />
          </Form.Item>
          <Form.Item
            name="base_url"
            label="文本/通用 Base URL"
            rules={[{ required: true }, { type: 'url', message: '请输入有效 URL' }]}
          >
            <Input placeholder="https://api.openai.com/v1" />
          </Form.Item>
          <Form.Item name="image_base_url" label="图片 Base URL（可选覆盖）" rules={[{ type: 'url', message: '请输入有效 URL' }]}>
            <Input placeholder="留空则回退到文本/通用 Base URL" />
          </Form.Item>
          <Form.Item name="video_base_url" label="视频 Base URL（可选覆盖）" rules={[{ type: 'url', message: '请输入有效 URL' }]}>
            <Input placeholder="留空则回退到文本/通用 Base URL" />
          </Form.Item>
          <Form.Item name="api_key" label="API Key" help={providerEditing ? '留空则不修改' : '请勿分享密钥'}>
            <Input.Password placeholder="AK" disabled={credentialsLoading} />
          </Form.Item>
          <Form.Item name="api_secret" label="API Secret" help={providerEditing ? '留空则不修改' : undefined}>
            <Input.Password placeholder="SK" disabled={credentialsLoading} />
          </Form.Item>
          <Form.Item name="description" label="描述">
            <Input.TextArea rows={2} placeholder="支持 GPT 系列模型" />
          </Form.Item>
          <Form.Item name="status" label="状态" initialValue="active">
            <Select
              options={[
                { label: '活跃', value: 'active' },
                { label: '测试中', value: 'testing' },
                { label: '禁用', value: 'disabled' },
              ]}
            />
          </Form.Item>
        </Form>
      </Modal>
    </>
  )
}
