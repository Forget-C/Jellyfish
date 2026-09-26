import { useEffect, useState, useMemo } from 'react'
import {
  Layout,
  Input,
  Button,
  Table,
  Tag,
  Space,
  Card,
  Dropdown,
  Drawer,
  Modal,
  Form,
  Select,
  message,
  Tooltip,
  Empty,
  Grid,
} from 'antd'
import type { FormInstance, TableColumnsType } from 'antd'
import {
  PlusOutlined,
  EditOutlined,
  DeleteOutlined,
  CopyOutlined,
  ExportOutlined,
  MenuOutlined,
  AppstoreOutlined,
  UnorderedListOutlined,
  DownOutlined,
  RightOutlined,
  ThunderboltOutlined,
  WarningOutlined,
} from '@ant-design/icons'
import { LlmService } from '../../../services/generated/services/LlmService'
import type { ProviderRead, ProviderStatus, ProviderSupportedRead } from '../../../services/generated'
import { TechnicalDetailSection } from '../project/ProjectWorkbench/components/workbench/TechnicalDetailCollapse'
import {
  PROVIDER_STATUS_MAP,
  SORT_OPTIONS,
  TABLE_ACTION_BTN_EDIT_CLASS,
  TABLE_ACTION_BTN_MORE_CLASS,
  TABLE_ACTION_BTN_TEST_CLASS,
  describeAddress,
  describeCreatedBy,
  describeForList,
  isImplementationDetailText,
} from './constants'

/** 「这条描述含技术细节」时的悬停说明（全文在默认收起的「技术详情」里）。 */
const DESCRIPTION_HIDDEN_HINT = '这条接入说明含技术细节，已收进「技术详情」'

export default function ProvidersTab() {
  const [providers, setProviders] = useState<ProviderRead[]>([])
  const [supportedSpecs, setSupportedSpecs] = useState<ProviderSupportedRead[]>([])
  const [supportedLoading, setSupportedLoading] = useState(true)
  const [loading, setLoading] = useState(true)
  const [search, setSearch] = useState('')
  const [sortBy, setSortBy] = useState<'updated' | 'name'>('updated')
  const [viewMode, setViewMode] = useState<'table' | 'card'>('table')
  const [selectedProvider, setSelectedProvider] = useState<ProviderRead | null>(null)
  const [detailPanelOpen, setDetailPanelOpen] = useState(false)
  const [treeCollapsed, setTreeCollapsed] = useState(false)
  const [providerModalOpen, setProviderModalOpen] = useState(false)
  const [providerEditing, setProviderEditing] = useState<ProviderRead | null>(null)
  const [form] = Form.useForm()
  const { lg } = Grid.useBreakpoint()
  const isLargeScreen = lg ?? false

  const load = async () => {
    setLoading(true)
    try {
      const order = sortBy === 'name' ? 'name' : 'updated_at'
      const res = await LlmService.listProvidersApiV1LlmProvidersGet({
        q: search.trim() || undefined,
        order,
        isDesc: true,
        page: 1,
        pageSize: 100,
      })
      setProviders(res.data?.items ?? [])
    } catch {
      message.error('加载失败')
    } finally {
      setLoading(false)
    }
  }

  useEffect(() => {
    void load()
  }, [search, sortBy])

  useEffect(() => {
    let cancelled = false
    ;(async () => {
      setSupportedLoading(true)
      try {
        const res = await LlmService.listSupportedProvidersApiV1LlmProvidersSupportedGet({})
        if (!cancelled) setSupportedSpecs(res.data ?? [])
      } catch {
        if (!cancelled) {
          message.error('加载系统支持的供应商列表失败')
          setSupportedSpecs([])
        }
      } finally {
        if (!cancelled) setSupportedLoading(false)
      }
    })()
    return () => {
      cancelled = true
    }
  }, [])

  const providerNameOptions = useMemo(() => {
    const fromApi = supportedSpecs.map((s) => ({
      label: s.is_experimental ? `${s.display_name}（实验）` : s.display_name,
      value: s.display_name,
    }))
    const name = providerEditing?.name?.trim()
    if (!name) return fromApi
    const known = supportedSpecs.some(
      (s) => s.display_name === name || (s.aliases?.length && s.aliases.includes(name)),
    )
    if (known) return fromApi
    return [{ label: `${name}（历史/未在清单内）`, value: name }, ...fromApi]
  }, [supportedSpecs, providerEditing])

  const applyDefaultBaseUrlForDisplayName = (displayName: string) => {
    const spec = supportedSpecs.find(
      (s) => s.display_name === displayName || (s.aliases?.length && s.aliases.includes(displayName)),
    )
    const def = spec?.default_base_url?.trim()
    if (!def) return
    const current = (form.getFieldValue('base_url') as string | undefined)?.trim()
    if (!providerEditing || !current) {
      form.setFieldsValue({ base_url: def })
    }
  }

  const providerList = useMemo(() => {
    let list = providers
    if (sortBy === 'name') list = [...list].sort((a, b) => a.name.localeCompare(b.name))
    return list
  }, [providers, sortBy])

  /**
   * 配置检查（**不是**假的「连接成功」）。
   *
   * 为什么不叫「测试连接」：本环境没有连通性探测能力，唯一的真实连通性验证
   * 就是发一次真实请求——那会产生费用，且演练模式下会被守卫拦下。
   * 以前这里用 `setTimeout(800)` 后恒报「连接成功」，属于纯粹的假反馈，
   * 正是「按钮存在但不知道接口有没有接通」的来源之一，已删除。
   * 现在只核对后端确实下发的字段，并把「真实连通性怎么验」讲清楚。
   *
   * 文案口径（审计 §4.7）：`端点` 是开发术语（宽词表命中）、`门禁` 是主区禁词，
   * 两个词都从这句用户能看到的提示里去掉，改用「本页不做连通性探测」「演练模式」。
   */
  const handleCheckConfig = (provider?: ProviderRead) => {
    const p = provider ?? selectedProvider
    if (!p) return
    const issues: string[] = []
    if (!p.base_url?.trim()) issues.push('缺少接口地址')
    if (p.status === 'disabled') issues.push('账号状态为「已停用」')
    if (issues.length > 0) {
      message.warning(`配置不完整：${issues.join('；')}`)
      return
    }
    message.info(
      `${p.name}：配置完整（接口地址已填，账号状态「${p.status === 'active' ? '可用' : '测试中'}」）。` +
        '本页不做连通性探测，真实连通性需要发起一次真实请求（会计费，演练模式下会被拦下）；' +
        '请在各个生成入口顶部的状态条确认当前是否允许真实调用。',
      8,
    )
  }

  const handleSaveProvider = async () => {
    try {
      const values = await form.validateFields()
      if (providerEditing) {
        const requestBody: Parameters<typeof LlmService.updateProviderApiV1LlmProvidersProviderIdPatch>[0]['requestBody'] = {
          name: values.name,
          base_url: values.base_url,
          image_base_url: values.image_base_url ?? null,
          video_base_url: values.video_base_url ?? null,
          description: values.description ?? null,
          status: values.status ?? null,
        }
        if (values.api_key && values.api_key !== '********') requestBody.api_key = values.api_key
        if (values.api_secret && values.api_secret !== '********') requestBody.api_secret = values.api_secret
        await LlmService.updateProviderApiV1LlmProvidersProviderIdPatch({
          providerId: providerEditing.id,
          requestBody,
        })
        message.success('供应商已更新')
      } else {
        const id =
          typeof crypto !== 'undefined' && crypto.randomUUID
            ? crypto.randomUUID()
            : `prov_${Date.now()}_${Math.random().toString(36).slice(2, 11)}`
        await LlmService.createProviderApiV1LlmProvidersPost({
          requestBody: {
            id,
            name: values.name,
            base_url: values.base_url,
            image_base_url: values.image_base_url ?? null,
            video_base_url: values.video_base_url ?? null,
            description: values.description,
            status: values.status,
            api_key: values.api_key,
            api_secret: values.api_secret,
          },
        })
        message.success('供应商已添加')
      }
      setProviderModalOpen(false)
      setProviderEditing(null)
      form.resetFields()
      void load()
    } catch (e) {
      if (e && typeof e === 'object' && 'errorFields' in e) return
      message.error('保存失败')
    }
  }

  const handleDeleteProvider = async (p: ProviderRead) => {
    let linked = 0
    try {
      const countRes = await LlmService.listModelsApiV1LlmModelsGet({
        providerId: p.id,
        pageSize: 1,
      })
      linked = countRes.data?.pagination?.total ?? 0
    } catch {
      // ignore
    }
    Modal.confirm({
      title: '删除供应商',
      content:
        linked > 0
          ? `该供应商下还有 ${linked} 个模型，删除后关联模型将失效。确定删除？`
          : '确定删除该供应商？',
      okText: '删除',
      okType: 'danger',
      onOk: async () => {
        await LlmService.deleteProviderApiV1LlmProvidersProviderIdDelete({ providerId: p.id })
        message.success('已删除')
        if (selectedProvider?.id === p.id) setSelectedProvider(null)
        void load()
      },
    })
  }

  const openProviderModal = (p?: ProviderRead) => {
    setProviderEditing(p ?? null)
    if (p) {
      form.setFieldsValue({
        name: p.name,
        base_url: p.base_url,
        image_base_url: p.image_base_url ?? null,
        video_base_url: p.video_base_url ?? null,
        api_key: '********',
        api_secret: '********',
        description: p.description,
        status: p.status ?? 'active',
      })
    } else {
      form.resetFields()
    }
    setProviderModalOpen(true)
  }

  const providerColumns: TableColumnsType<ProviderRead> = [
    { title: '名称', dataIndex: 'name', key: 'name', ellipsis: true, render: (n) => <Space>{n}</Space> },
    {
      /* 审计 §4.7-548：标签保留（供应商配置页允许技术性最强），但**中文在前、英文括注**。
         ⚠️ 同一列的悬停提示给出的是**同一个掩码值**：改前 `title={url}` 给完整地址，
         而可见文本是掩码 —— hover 即见全文等于掩码白做（审计 §5.5-D 实测）。 */
      title: '接口地址（Base URL）',
      dataIndex: 'base_url',
      key: 'base_url',
      ellipsis: true,
      render: (url: string) => (
        <Tooltip title={describeAddress(url)}>
          <span>{describeAddress(url)}</span>
        </Tooltip>
      ),
    },
    {
      /* 审计 §4.7-549：已完成掩码（做对了）→ 只把标题改成「中文在前英文括注」，保留 `********`。 */
      title: '访问密钥（AK/SK）',
      key: 'aksk',
      render: () => (
        <span>
          <WarningOutlined className="text-amber-500 mr-1" />
          ******** / ********
        </span>
      ),
    },
    {
      /* 审计 §4.7-550：**描述列原样直渲**是模式 4 的落点（运行时实测描述里写着
         `image_service_openai_shim.py`、`/images/generations` 这类实现细节）。
         含实现细节 → 列表只显示「自定义接入」，悬停不给全文，原文进「技术详情」。 */
      title: '描述',
      dataIndex: 'description',
      key: 'description',
      ellipsis: true,
      render: (d: string) => (
        <Tooltip title={isImplementationDetailText(d) ? DESCRIPTION_HIDDEN_HINT : d || '—'}>
          <span>{describeForList(d)}</span>
        </Tooltip>
      ),
    },
    {
      title: '状态',
      dataIndex: 'status',
      key: 'status',
      width: 90,
      render: (s: ProviderStatus) => (
        <Tag color={PROVIDER_STATUS_MAP[s]?.color}>{PROVIDER_STATUS_MAP[s]?.text}</Tag>
      ),
    },
    {
      /* 审计 §4.7-551：创建人列原来直渲 `created_by` 原值（运行时实测显示 `integration`）。
         现在服务账号映射为「系统预置」，真人用户名套业务句式。 */
      title: '创建人',
      dataIndex: 'created_by',
      key: 'created_by',
      width: 120,
      render: (c: string) => describeCreatedBy(c),
    },
    {
      title: '操作',
      key: 'action',
      width: 112,
      fixed: 'right',
      align: 'center',
      render: (_, record) => (
        <Space size={4} className="flex-nowrap justify-center">
          <Tooltip title="编辑">
            <Button
              type="text"
              size="small"
              className={TABLE_ACTION_BTN_EDIT_CLASS}
              icon={<EditOutlined />}
              onClick={(e) => {
                e.stopPropagation()
                openProviderModal(record)
              }}
            />
          </Tooltip>
          <Tooltip title="检查配置（不做真实连通性探测：那会产生费用）">
            <Button
              type="text"
              size="small"
              className={TABLE_ACTION_BTN_TEST_CLASS}
              icon={<ThunderboltOutlined />}
              onClick={(e) => {
                e.stopPropagation()
                handleCheckConfig(record)
              }}
            />
          </Tooltip>
          <Dropdown
            menu={{
              items: [
                { key: 'copy', label: '复制', icon: <CopyOutlined /> },
                { key: 'export', label: '导出配置', icon: <ExportOutlined /> },
                { type: 'divider' },
                {
                  key: 'delete',
                  label: '删除',
                  danger: true,
                  icon: <DeleteOutlined />,
                  onClick: ({ domEvent }) => {
                    domEvent.stopPropagation()
                    handleDeleteProvider(record)
                  },
                },
              ],
            }}
            trigger={['click']}
          >
            <Tooltip title="更多">
              <Button
                type="text"
                size="small"
                className={TABLE_ACTION_BTN_MORE_CLASS}
                icon={<MenuOutlined />}
                onClick={(e) => e.stopPropagation()}
              />
            </Tooltip>
          </Dropdown>
        </Space>
      ),
    },
  ]

  return (
    <>
      <div className="flex-shrink-0 px-4 py-2 border-b border-gray-100 bg-white flex flex-wrap items-center justify-between gap-2">
        <div className="flex items-center gap-2">
          <span className="text-gray-600 text-sm">共 {providers.length} 个供应商</span>
        </div>
        <Space wrap>
          <Button type="primary" icon={<PlusOutlined />} onClick={() => openProviderModal()}>
            添加供应商
          </Button>
          <Input
            placeholder="搜索名称/描述"
            allowClear
            className="w-48"
            value={search}
            onChange={(e) => setSearch(e.target.value)}
          />
          <Dropdown
            menu={{
              items: SORT_OPTIONS.filter((o) => o.value !== 'category').map((o) => ({
                key: o.value,
                label: o.label,
                onClick: () => setSortBy(o.value as 'updated' | 'name'),
              })),
            }}
          >
            <Button icon={<DownOutlined />}>
              排序：{SORT_OPTIONS.find((s) => s.value === sortBy)?.label}
            </Button>
          </Dropdown>
        </Space>
      </div>

      <Layout className="flex-1 min-h-0 flex-row overflow-hidden">
        <div
          className="flex-shrink-0 border-r border-gray-200 bg-white overflow-auto"
          style={{ width: treeCollapsed ? 48 : 200 }}
        >
          {treeCollapsed ? (
            <Button
              type="text"
              icon={<RightOutlined />}
              onClick={() => setTreeCollapsed(false)}
              className="w-full rounded-none"
            />
          ) : (
            <>
              <div className="flex items-center justify-between px-3 py-2 border-b border-gray-100">
                <span className="text-sm font-medium text-gray-700">筛选</span>
                <Button
                  type="text"
                  size="small"
                  icon={<RightOutlined rotate={180} />}
                  onClick={() => setTreeCollapsed(true)}
                />
              </div>
              <div className="p-3 text-sm text-gray-500">点击列表项查看详情</div>
            </>
          )}
        </div>

        <div className="flex-1 min-w-0 overflow-auto p-4 bg-gray-50">
          <div className="flex justify-end gap-1 mb-2">
            <Button
              type={viewMode === 'table' ? 'primary' : 'default'}
              size="small"
              icon={<UnorderedListOutlined />}
              onClick={() => setViewMode('table')}
            />
            <Button
              type={viewMode === 'card' ? 'primary' : 'default'}
              size="small"
              icon={<AppstoreOutlined />}
              onClick={() => setViewMode('card')}
            />
          </div>

          {providerList.length === 0 ? (
            <Card>
              <Empty
                description={
                  providers.length === 0 ? '暂无供应商，点击「添加供应商」开始' : '无匹配结果'
                }
              >
                {providers.length === 0 && (
                  <Button type="primary" icon={<PlusOutlined />} onClick={() => openProviderModal()}>
                    添加第一个供应商
                  </Button>
                )}
              </Empty>
            </Card>
          ) : viewMode === 'table' ? (
            <Card>
              <Table<ProviderRead>
                rowKey="id"
                loading={loading}
                columns={providerColumns}
                dataSource={providerList}
                scroll={{ x: 1180 }}
                pagination={{ pageSize: 20 }}
                onRow={(record) => ({
                  onClick: () => {
                    setSelectedProvider(record)
                    setDetailPanelOpen(true)
                  },
                  style: { cursor: 'pointer' },
                })}
                size="small"
              />
            </Card>
          ) : (
            <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 xl:grid-cols-4 gap-4">
              {providerList.map((p) => (
                <Card
                  key={p.id}
                  hoverable
                  className="cursor-pointer"
                  style={{ minHeight: 220 }}
                  onClick={() => {
                    setSelectedProvider(p)
                    setDetailPanelOpen(true)
                  }}
                  actions={[
                    <Button
                      key="edit"
                      type="text"
                      size="small"
                      icon={<EditOutlined />}
                      onClick={(e) => {
                        e.stopPropagation()
                        openProviderModal(p)
                      }}
                    >
                      编辑
                    </Button>,
                    <Button
                      key="test"
                      type="text"
                      size="small"
                      icon={<ThunderboltOutlined />}
                      onClick={(e) => {
                        e.stopPropagation()
                        handleCheckConfig(p)
                      }}
                    >
                      检查配置
                    </Button>,
                    <Dropdown
                      key="more"
                      menu={{
                        items: [
                          {
                            key: 'delete',
                            label: '删除',
                            danger: true,
                            onClick: () => handleDeleteProvider(p),
                          },
                        ],
                      }}
                      trigger={['click']}
                    >
                      <Button type="text" size="small" onClick={(e) => e.stopPropagation()}>
                        更多
                      </Button>
                    </Dropdown>,
                  ]}
                >
                  <div className="font-medium mb-1">{p.name}</div>
                  {/* 悬停提示与可见文本**同口径**（审计 §5.5-D）：都走 `describeAddress`。 */}
                  <div className="text-gray-500 text-sm mb-1 truncate" title={describeAddress(p.base_url)}>
                    接口地址：{describeAddress(p.base_url)}
                  </div>
                  <div className="text-gray-500 text-sm mb-1">访问密钥：******** / ********</div>
                  <div className="text-gray-500 text-sm line-clamp-2 mb-2">{describeForList(p.description)}</div>
                  <Tag color={PROVIDER_STATUS_MAP[p.status ?? 'active']?.color}>
                    {PROVIDER_STATUS_MAP[p.status ?? 'active']?.text}
                  </Tag>
                  {p.created_by && (
                    <span className="text-xs text-gray-400 ml-2">{describeCreatedBy(p.created_by)}</span>
                  )}
                </Card>
              ))}
            </div>
          )}
        </div>

        {selectedProvider && isLargeScreen && (
          <div
            className="flex-shrink-0 overflow-auto border-l border-gray-200 bg-white"
            style={{ width: '36%', minWidth: 320 }}
          >
            <div className="p-4 border-b border-gray-100 flex items-center justify-between">
              <span className="font-medium">详情</span>
              <Button
                type="link"
                size="small"
                onClick={() => {
                  setDetailPanelOpen(false)
                  setSelectedProvider(null)
                }}
              >
                收起
              </Button>
            </div>
            <div className="p-4 space-y-4">
              <div>
                <div className="text-sm text-gray-500 mb-1">名称</div>
                <div className="font-medium">{selectedProvider.name}</div>
              </div>
              <div>
                <div className="text-sm text-gray-500 mb-1">文本/通用接口地址</div>
                {/* 悬停与可见文本同口径（审计 §5.5-D）；非公网地址带「仅本机可达」标注。 */}
                <Tooltip title={describeAddress(selectedProvider.base_url)}>
                  <span className="text-sm">{describeAddress(selectedProvider.base_url)}</span>
                </Tooltip>
              </div>
              <div>
                <div className="text-sm text-gray-500 mb-1">图片接口地址（可选覆盖）</div>
                <span className="text-sm">
                  {selectedProvider.image_base_url ? describeAddress(selectedProvider.image_base_url) : '回退到文本/通用'}
                </span>
              </div>
              <div>
                <div className="text-sm text-gray-500 mb-1">视频接口地址（可选覆盖）</div>
                <span className="text-sm">
                  {selectedProvider.video_base_url ? describeAddress(selectedProvider.video_base_url) : '回退到文本/通用'}
                </span>
              </div>
              <div>
                <div className="text-sm text-gray-500 mb-1">描述</div>
                <div className="text-gray-700 text-sm">{describeForList(selectedProvider.description)}</div>
                {/* 含实现细节的原始描述**只在这里**（默认收起的「技术详情」）全文可见。 */}
                {isImplementationDetailText(selectedProvider.description ?? '') && (
                  <div className="mt-1">
                    <TechnicalDetailSection testId="provider-description-detail">
                      <div className="text-[11px] leading-5 text-gray-600">
                        {selectedProvider.description}
                      </div>
                    </TechnicalDetailSection>
                  </div>
                )}
              </div>
              <div>
                <div className="text-sm text-gray-500 mb-1">创建人</div>
                <div className="text-sm">{describeCreatedBy(selectedProvider.created_by)}</div>
              </div>
              <Space>
                <Button
                  type="primary"
                  icon={<EditOutlined />}
                  onClick={() => openProviderModal(selectedProvider)}
                >
                  编辑
                </Button>
                <Button icon={<ThunderboltOutlined />} onClick={() => handleCheckConfig()}>
                  检查配置
                </Button>
              </Space>
            </div>
          </div>
        )}

        {selectedProvider && !isLargeScreen && (
          <Drawer
            title="详情"
            placement="right"
            open={detailPanelOpen}
            onClose={() => setDetailPanelOpen(false)}
            width="min(100%, 400px)"
          >
            <div className="space-y-4">
              <div>
                <div className="text-sm text-gray-500 mb-1">名称</div>
                <div className="font-medium">{selectedProvider.name}</div>
              </div>
              <div>
                <div className="text-sm text-gray-500 mb-1">文本/通用接口地址</div>
                <span className="text-sm">{describeAddress(selectedProvider.base_url)}</span>
              </div>
              <div>
                <div className="text-sm text-gray-500 mb-1">图片接口地址（可选覆盖）</div>
                <span className="text-sm">{selectedProvider.image_base_url ? describeAddress(selectedProvider.image_base_url) : '回退到文本/通用'}</span>
              </div>
              <div>
                <div className="text-sm text-gray-500 mb-1">视频接口地址（可选覆盖）</div>
                <span className="text-sm">{selectedProvider.video_base_url ? describeAddress(selectedProvider.video_base_url) : '回退到文本/通用'}</span>
              </div>
              <div>
                <div className="text-sm text-gray-500 mb-1">描述</div>
                <div className="text-gray-700 text-sm">{describeForList(selectedProvider.description)}</div>
                {isImplementationDetailText(selectedProvider.description ?? '') && (
                  <div className="mt-1">
                    <TechnicalDetailSection testId="provider-description-detail">
                      <div className="text-[11px] leading-5 text-gray-600">
                        {selectedProvider.description}
                      </div>
                    </TechnicalDetailSection>
                  </div>
                )}
              </div>
              <Space>
                <Button
                  type="primary"
                  icon={<EditOutlined />}
                  onClick={() => openProviderModal(selectedProvider)}
                >
                  编辑
                </Button>
                <Button icon={<ThunderboltOutlined />} onClick={() => handleCheckConfig()}>
                  检查配置
                </Button>
              </Space>
            </div>
          </Drawer>
        )}
      </Layout>

      <Modal
        title={providerEditing ? '编辑供应商' : '添加供应商'}
        open={providerModalOpen}
        onCancel={() => {
          setProviderModalOpen(false)
          setProviderEditing(null)
          form.resetFields()
        }}
        onOk={() => void handleSaveProvider()}
        width={560}
        destroyOnClose
      >
        <ProviderTechnicalConfigFields
          form={form}
          providerEditing={providerEditing}
          supportedLoading={supportedLoading}
          providerNameOptions={providerNameOptions}
          onProviderNameChange={applyDefaultBaseUrlForDisplayName}
        />
      </Modal>
    </>
  )
}

/* ------------------------------------------- 供应商技术配置区块（本页唯一技术性豁免） */

export type ProviderTechnicalConfigFieldsProps = {
  form: FormInstance
  providerEditing: ProviderRead | null
  supportedLoading: boolean
  providerNameOptions: { label: string; value: string }[]
  onProviderNameChange: (displayName: string) => void
}

/**
 * **供应商技术配置区块**（编辑 / 新增供应商表单）。
 *
 * ## 这是本批登记的唯一技术性豁免范围，为什么
 *
 * 审计 §4.7 原文：「模型页是配置页，技术性最强」「供应商名（`apimart`）、`Base URL`、
 * `AK/SK` 这些属本页核心功能，允许保留（标签保留（供应商配置页允许技术性最强））」。
 * 本区块就是这些技术词汇的**唯一落点**：地址 / 密钥字段的标签、`AK` / `SK` 占位符。
 *
 * ## 豁免的口径（护栏里逐条钉住）
 *
 * 1. **范围由函数边界圈定，不用行号**（审计 §8.1.1：行号会随改动漂移）；
 * 2. 标签一律「**中文在前、英文括注**」（「接口地址（Base URL）」「访问密钥（AK/SK）」）；
 * 3. 裸写英文技术词（`Base URL` / `AK/SK` / `API Key` / `API Secret`）与裸写凭据占位符
 *    （`AK` / `SK`）**只允许出现在本函数体内**，主区（表格列 / 卡片 / 详情面板）一律用
 *    纯中文口径（「接口地址」「访问密钥」）；
 * 4. **不许把主区内容搬进来**：本区块只做表单字段，不调 `message.*`、不渲列表；
 * 5. 地址类占位符不许写死具体友商的域名（审计 §4.7-553：改前是 `https://api.openai.com/v1`）。
 */
function ProviderTechnicalConfigFields(props: ProviderTechnicalConfigFieldsProps) {
  const { form, providerEditing, supportedLoading, providerNameOptions, onProviderNameChange } = props
  /* 表单校验提示与标签必须同口径：改前 `label` 写「名称」而校验提示说「请选择供应商」。 */
  const nameRequiredMessage = '请填写名称'
  const invalidAddressMessage = '请输入有效的接口地址'
  return (
    <Form form={form} layout="vertical" className="pt-2">
      <Form.Item name="name" label="名称" rules={[{ required: true, message: nameRequiredMessage }]}>
        <Select
          showSearch
          optionFilterProp="label"
          loading={supportedLoading}
          placeholder={supportedLoading ? '加载供应商清单…' : '选择供应商'}
          options={providerNameOptions}
          notFoundContent={supportedLoading ? '加载中…' : '暂无数据'}
          onChange={(v) => onProviderNameChange(String(v))}
        />
      </Form.Item>
      <Form.Item
        name="base_url"
        label="文本/通用接口地址（Base URL）"
        rules={[{ required: true }, { type: 'url', message: invalidAddressMessage }]}
      >
        <Input placeholder="例如：https://你的服务商接口地址/v1" />
      </Form.Item>
      <Form.Item
        name="image_base_url"
        label="图片接口地址（可选覆盖）"
        rules={[{ type: 'url', message: invalidAddressMessage }]}
      >
        <Input placeholder="留空则回退到文本/通用接口地址" />
      </Form.Item>
      <Form.Item
        name="video_base_url"
        label="视频接口地址（可选覆盖）"
        rules={[{ type: 'url', message: invalidAddressMessage }]}
      >
        <Input placeholder="留空则回退到文本/通用接口地址" />
      </Form.Item>
      <Form.Item
        name="api_key"
        label="访问密钥（API Key）"
        help={providerEditing ? '留空则不修改' : '请勿分享密钥'}
      >
        <Input.Password placeholder="AK" />
      </Form.Item>
      <Form.Item
        name="api_secret"
        label="密钥口令（API Secret）"
        help={providerEditing ? '留空则不修改' : undefined}
      >
        <Input.Password placeholder="SK" />
      </Form.Item>
      <Form.Item name="description" label="描述">
        <Input.TextArea rows={2} placeholder="例如：本供应商负责的能力范围" />
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
  )
}
