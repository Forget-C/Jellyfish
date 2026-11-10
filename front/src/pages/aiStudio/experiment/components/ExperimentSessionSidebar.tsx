/** 实验室左侧最近会话列表。 */
import { DeleteOutlined, EditOutlined, MessageOutlined, MoreOutlined, PictureOutlined, PlusOutlined, VideoCameraOutlined } from '@ant-design/icons'
import { Alert, Button, Dropdown, Input, Modal, Tooltip } from 'antd'
import type { ReactNode } from 'react'
import { useState } from 'react'
import type { ExperimentSessionRead } from '../../../../services/generated'
import { ExperimentSessionConfirmation } from './ExperimentSessionConfirmation'

type ExperimentLabType = ExperimentSessionRead['lab_type']

type ExperimentSessionSidebarProps = {
  value?: string
  currentSessionDirty?: boolean
  currentSessionGenerating?: boolean
  sessions: ExperimentSessionRead[]
  labType: ExperimentLabType
  loading: boolean
  failedTypes: ExperimentLabType[]
  onRetry: () => void
  onChange: (session: ExperimentSessionRead) => void
  onStartDraft: (labType: ExperimentLabType) => void
  onRename?: (sessionId: string, title: string) => Promise<void>
  onDelete?: (sessionId: string) => Promise<void>
}

/**
 * 呈现类似聊天应用的最近会话侧栏，统一实验室的切换与会话管理入口。
 *
 * 新建入口只选择实验模态并进入草稿态；首条有效提交由页面创建持久化会话。
 */
export function ExperimentSessionSidebar({ value, currentSessionDirty, currentSessionGenerating, sessions, labType, loading, failedTypes, onRetry, onChange, onStartDraft, onRename, onDelete }: ExperimentSessionSidebarProps) {
  const [renameOpen, setRenameOpen] = useState(false)
  const [targetSession, setTargetSession] = useState<ExperimentSessionRead | null>(null)
  const [title, setTitle] = useState('')
  const [deleteTarget, setDeleteTarget] = useState<ExperimentSessionRead>()

  /** 打开指定会话的重命名弹窗。 */
  const openRename = (session: ExperimentSessionRead) => {
    setTargetSession(session)
    setTitle(session.title)
    setRenameOpen(true)
  }

  /** 返回会话模态对应的低干扰图标与名称。 */
  const labMeta: Record<ExperimentLabType, { label: string; icon: ReactNode }> = {
    text: { label: '文本', icon: <MessageOutlined /> },
    image: { label: '图片', icon: <PictureOutlined /> },
    video: { label: '视频', icon: <VideoCameraOutlined /> },
  }

  /** 生成每个会话自己的悬浮操作菜单。 */
  const getMenuItems = (session: ExperimentSessionRead) => [
    onRename ? { key: 'rename', icon: <EditOutlined aria-hidden="true" />, label: '重命名', onClick: () => openRename(session) } : null,
    onDelete ? {
      key: 'delete',
      icon: <DeleteOutlined aria-hidden="true" />,
      label: session.id === value && currentSessionGenerating ? '删除会话（文本生成中）' : '删除会话',
      disabled: session.id === value && currentSessionGenerating,
      danger: true,
      onClick: () => setDeleteTarget(session),
    } : null,
  ].filter(Boolean)

  const visibleSessions = sessions.filter(session => session.lab_type === labType)
  return <aside className="experiment-navigation">
    <nav className="experiment-types" aria-label="实验室类型">
      {(Object.keys(labMeta) as ExperimentLabType[]).map(type => <button
        key={type} type="button" className="experiment-nav-item" aria-pressed={labType === type}
        onClick={() => onStartDraft(type)}>
        <span aria-hidden="true">{labMeta[type].icon}</span>
        {labMeta[type].label}
      </button>)}
    </nav>
    <div className="experiment-session-heading">
      <h2>最近会话</h2>
      <Button type="text" size="small" icon={<PlusOutlined />} aria-label="新建对话" onClick={() => onStartDraft(labType)}>新建对话</Button>
    </div>
    {failedTypes.length > 0 && <Alert type="error" message={failedTypes.length === 3 ? '读取会话失败' : '部分会话读取失败'}
      action={<Button type="text" size="small" aria-label="重试" onClick={onRetry}>重试</Button>} />}
    <nav className="experiment-session-list" aria-label="当前类型会话" aria-busy={loading}>
      {!visibleSessions.length && !failedTypes.includes(labType) && <p role="status">{loading ? '正在读取会话…' : '暂无会话'}</p>}
      {visibleSessions.map((session) => {
        const selected = session.id === value
        const menuItems = getMenuItems(session)
        return <div key={session.id} className="experiment-session-row">
          <button
            type="button"
            className="experiment-nav-item experiment-session-link"
            onClick={() => onChange(session)}
            aria-current={selected ? 'page' : undefined}
          >
            <Tooltip title={session.title} placement="right" mouseEnterDelay={0.6}>
              <span className={`block truncate text-sm leading-6 ${selected ? 'font-semibold' : 'font-normal'}`}>{session.title}</span>
            </Tooltip>
          </button>
          {menuItems.length ? <Dropdown menu={{ items: menuItems }} trigger={['click']} placement="bottomRight" overlayClassName="experiment-session-dropdown">
            <Button type="text" size="small" icon={<MoreOutlined />} aria-label={`${session.title} 更多操作`} className="experiment-session-actions experiment-icon-action" />
          </Dropdown> : null}
        </div>
      })}
    </nav>
    <ExperimentSessionConfirmation
      title="删除会话"
      description={`将删除“${deleteTarget?.title}”及其历史消息。此操作无法撤销。${deleteTarget?.id === value && currentSessionDirty ? ' 当前未发送内容也将被放弃。' : ''}`}
      run={deleteTarget && onDelete ? () => onDelete(deleteTarget.id) : undefined}
      failure="删除会话失败；运行中任务不可删除"
      onClose={() => setDeleteTarget(undefined)}
    />
    <Modal
      title="重命名会话"
      open={renameOpen}
      onCancel={() => setRenameOpen(false)}
      onOk={async () => {
        if (!title.trim() || !onRename || !targetSession) return
        await onRename(targetSession.id, title.trim())
        setRenameOpen(false)
      }}
    >
      <Input value={title} onChange={(event) => setTitle(event.target.value)} maxLength={255} autoFocus />
    </Modal>
  </aside>
}
