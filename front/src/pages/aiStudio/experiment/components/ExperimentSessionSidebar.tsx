/** 实验室左侧最近会话列表。 */
import { useUiText } from '../../../../uiText'
import { DownOutlined, DeleteOutlined, EditOutlined, MessageOutlined, MoreOutlined, PictureOutlined, PlusOutlined, VideoCameraOutlined } from '@ant-design/icons'
import { Alert, Button, Dropdown, Input, Modal, Tooltip } from 'antd'
import type { ReactNode } from 'react'
import { useRef, useState } from 'react'
import type { ExperimentSessionRead } from '../../../../services/generated'
import { ExperimentSessionConfirmation } from './ExperimentSessionConfirmation'

type ExperimentLabType = ExperimentSessionRead['lab_type']

type ExperimentSessionSidebarProps = {
  value?: string
  currentSessionDirty?: boolean
  currentSessionGenerating?: boolean
  sessions: ExperimentSessionRead[]
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
export function ExperimentSessionSidebar({ value, currentSessionDirty, currentSessionGenerating, sessions, loading, failedTypes, onRetry, onChange, onStartDraft, onRename, onDelete }: ExperimentSessionSidebarProps) {
  const uiText = useUiText()
  const newSessionTrigger = useRef<HTMLButtonElement>(null)
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
    chat: { label: uiText("多模态聊天"), icon: <MessageOutlined aria-hidden="true" /> },
    text: { label: uiText("文本"), icon: <MessageOutlined aria-hidden="true" /> },
    image: { label: uiText("图片"), icon: <PictureOutlined aria-hidden="true" /> },
    video: { label: uiText("视频"), icon: <VideoCameraOutlined aria-hidden="true" /> },
  }

  /** 生成每个会话自己的悬浮操作菜单。 */
  const getMenuItems = (session: ExperimentSessionRead) => [
    onRename ? { key: 'rename', icon: <EditOutlined aria-hidden="true" />, label: uiText("重命名"), onClick: () => openRename(session) } : null,
    onDelete ? {
      key: 'delete',
      icon: <DeleteOutlined aria-hidden="true" />,
      label: session.id === value && currentSessionGenerating ? uiText("删除会话（文本生成中）") : uiText("删除会话"),
      disabled: session.id === value && currentSessionGenerating,
      danger: true,
      onClick: () => setDeleteTarget(session),
    } : null,
  ].filter(Boolean)

  return <aside className="experiment-navigation">
    <div className="experiment-session-heading">
      <h2>{uiText("最近会话")}</h2>
      <Dropdown trigger={['click']} classNames={{ root: "experiment-session-dropdown" }} menu={{ items:
        (Object.keys(labMeta) as ExperimentLabType[]).map(type => ({
          key: type, icon: labMeta[type].icon, label: uiText("{{label}}会话", { label: labMeta[type].label }),
          onClick: () => {
            newSessionTrigger.current?.focus()
            onStartDraft(type)
          },
        })),
      }}>
        <Button ref={newSessionTrigger} type="text" icon={<PlusOutlined />} aria-label={uiText("新建会话")}>{uiText("新建")} <DownOutlined /></Button>
      </Dropdown>
    </div>
    {failedTypes.length > 0 && <Alert type="error"
      message={failedTypes.length === Object.keys(labMeta).length ? uiText("读取会话失败") : uiText("{{value1}}会话读取失败", { value1: failedTypes.map(type => labMeta[type].label).join('、') })}
      action={<Button type="text" size="small" aria-label={uiText("重试")} onClick={onRetry}>{uiText("重试")}</Button>} />}
    <nav className="experiment-session-list" aria-label={uiText("最近会话")} aria-busy={loading}>
      {!sessions.length && (loading || !failedTypes.length) && <p role="status">{loading ? uiText("正在读取会话…") : uiText("暂无会话，从右上方新建开始")}</p>}
      {sessions.map((session) => {
        const selected = session.id === value
        const menuItems = getMenuItems(session)
        return <div key={session.id} className="experiment-session-row">
          <button
            type="button"
            className="experiment-nav-item experiment-session-link"
            onClick={() => onChange(session)}
            aria-label={session.title}
            aria-description={uiText("{{label}}会话", { label: labMeta[session.lab_type].label })}
            aria-current={selected ? 'page' : undefined}
          >
            <span className="experiment-session-type" aria-hidden="true">{labMeta[session.lab_type].icon}</span>
            <Tooltip title={uiText("{{label}}会话 · {{title}}", { label: labMeta[session.lab_type].label, title: session.title })} placement="right" mouseEnterDelay={0.6}>
              <span className={`experiment-session-name ${selected ? 'font-semibold' : 'font-normal'}`}>{session.title}</span>
            </Tooltip>
          </button>
          {menuItems.length ? <Dropdown menu={{ items: menuItems }} trigger={['click']} placement="bottomRight" classNames={{ root: "experiment-session-dropdown" }}>
            <Button type="text" size="small" icon={<MoreOutlined />} aria-label={uiText("{{title}} 更多操作", { title: session.title })} className="experiment-session-actions experiment-icon-action" />
          </Dropdown> : null}
        </div>
      })}
    </nav>
    <ExperimentSessionConfirmation
      title={uiText("删除会话")}
      description={uiText("将删除“{{title}}”及其历史消息。此操作无法撤销。{{value2}}", { title: deleteTarget?.title, value2: deleteTarget?.id === value && currentSessionDirty ? uiText(" 当前未发送内容也将被放弃。") : '' })}
      run={deleteTarget && onDelete ? () => onDelete(deleteTarget.id) : undefined}
      failure={uiText("删除会话失败；运行中任务不可删除")}
      onClose={() => setDeleteTarget(undefined)}
    />
    <Modal
      title={uiText("重命名会话")}
      open={renameOpen}
      onCancel={() => setRenameOpen(false)}
      onOk={async () => {
        if (!title.trim() || !onRename || !targetSession) return
        await onRename(targetSession.id, title.trim())
        setRenameOpen(false)
      }}
    >
      <Input aria-label={uiText("会话名称")} value={title} onChange={(event) => setTitle(event.target.value)} maxLength={255} autoFocus />
    </Modal>
  </aside>
}
