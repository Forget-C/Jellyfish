/** 实验室左侧最近会话列表。 */
import { DeleteOutlined, EditOutlined, MessageOutlined, MoreOutlined, PictureOutlined, PlusOutlined, VideoCameraOutlined } from '@ant-design/icons'
import { Button, Dropdown, Input, Modal, Tooltip, message } from 'antd'
import type { ReactNode } from 'react'
import { useState } from 'react'
import type { ExperimentSessionRead } from '../../../../services/generated'

type ExperimentLabType = ExperimentSessionRead['lab_type']

type ExperimentSessionSidebarProps = {
  value?: string
  sessions: ExperimentSessionRead[]
  disabled?: boolean
  extensionSlot?: ReactNode
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
export function ExperimentSessionSidebar({ value, sessions, disabled = false, extensionSlot, onChange, onStartDraft, onRename, onDelete }: ExperimentSessionSidebarProps) {
  const [renameOpen, setRenameOpen] = useState(false)
  const [createOpen, setCreateOpen] = useState(false)
  const [targetSession, setTargetSession] = useState<ExperimentSessionRead | null>(null)
  const [title, setTitle] = useState('')

  /** 打开指定会话的重命名弹窗。 */
  const openRename = (session: ExperimentSessionRead) => {
    setTargetSession(session)
    setTitle(session.title)
    setRenameOpen(true)
  }

  /** 返回会话模态对应的低干扰图标与名称。 */
  const labMeta: Record<ExperimentLabType, { label: string; icon: ReactNode }> = {
    text: { label: '文本生成', icon: <MessageOutlined /> },
    image: { label: '图片生成', icon: <PictureOutlined /> },
    video: { label: '视频生成', icon: <VideoCameraOutlined /> },
  }

  /** 选择模态并通知页面进入对应的未持久化草稿态。 */
  const createSession = (labType: ExperimentLabType) => {
    setCreateOpen(false)
    onStartDraft(labType)
  }

  /** 生成每个会话自己的悬浮操作菜单。 */
  const getMenuItems = (session: ExperimentSessionRead) => [
    onRename ? { key: 'rename', icon: <EditOutlined />, label: '重命名', onClick: () => openRename(session) } : null,
    onDelete ? {
      key: 'delete',
      icon: <DeleteOutlined />,
      label: '删除对话',
      onClick: () => Modal.confirm({
        title: '删除对话',
        content: '删除后无法恢复。',
        okButtonProps: { danger: true },
        onOk: async () => {
          try {
            await onDelete(session.id)
          } catch {
            message.error('删除会话失败；运行中任务不可删除')
          }
        },
      }),
    } : null,
  ].filter(Boolean)

  return <aside className="hidden w-64 shrink-0 flex-col overflow-hidden border-r border-slate-200 bg-white px-3 py-4 lg:flex">
    <Button
      block
      icon={<span className="relative flex h-5 w-5 items-center justify-center" aria-hidden="true"><MessageOutlined className="text-lg" /><PlusOutlined className="absolute -right-0.5 -top-0.5 rounded-full bg-slate-100 text-[9px]" /></span>}
      onClick={() => setCreateOpen(true)}
      disabled={disabled}
      className="!h-11 !justify-start !gap-3 !rounded-xl !border-slate-200 !bg-slate-100 !px-4 !text-[15px] !font-medium !text-slate-900 !shadow-sm hover:!border-slate-300 hover:!bg-slate-200"
    >
      新建对话
    </Button>
    {extensionSlot ? <div className="mt-5" data-testid="experiment-sidebar-extension">{extensionSlot}</div> : null}
    <div className="mt-8 px-3 text-sm font-normal text-slate-400">最近对话</div>
    <div className="mt-3 flex min-h-0 flex-1 flex-col gap-1 overflow-y-auto pr-1">
      {sessions.map((session) => {
        const selected = session.id === value
        const menuItems = getMenuItems(session)
        return <div key={session.id} className={`group flex min-w-0 items-center rounded-xl transition-colors ${selected ? 'bg-slate-100 text-slate-950' : 'text-slate-800 hover:bg-slate-100'}`}>
          <button
            type="button"
            className="min-w-0 flex-1 border-0 bg-transparent px-3 py-2.5 text-left"
            onClick={() => onChange(session)}
            disabled={disabled}
            aria-current={selected ? 'page' : undefined}
          >
            <Tooltip title={session.title} placement="right" mouseEnterDelay={0.6}>
              <span className={`block truncate text-[15px] leading-6 ${selected ? 'font-semibold' : 'font-normal'}`}>{session.title}</span>
            </Tooltip>
          </button>
          {menuItems.length ? <Dropdown menu={{ items: menuItems }} trigger={['click']} placement="bottomRight" overlayClassName="experiment-session-dropdown">
            <Button type="text" size="small" icon={<MoreOutlined />} disabled={disabled} aria-label={`${session.title} 更多操作`} className="mr-1 shrink-0 !text-slate-500 !opacity-0 transition-opacity group-hover:!opacity-100 group-focus-within:!opacity-100 hover:!bg-slate-200" />
          </Dropdown> : null}
        </div>
      })}
    </div>
    <Modal className="experiment-create-modal" title="选择生成模态" open={createOpen} onCancel={() => setCreateOpen(false)} footer={null} width={680} centered>
      <div className="grid grid-cols-1 gap-4 py-4 sm:grid-cols-3">
        {(Object.keys(labMeta) as ExperimentLabType[]).map((labType) => <button key={labType} type="button" className="group flex min-h-32 flex-col items-center justify-center rounded-xl border border-dashed border-slate-300 bg-white p-5 text-slate-800 transition hover:-translate-y-0.5 hover:border-blue-400 hover:bg-blue-50 hover:text-blue-700 hover:shadow-sm focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-blue-500" onClick={() => createSession(labType)}>
          <span className="text-2xl transition-transform group-hover:scale-110">{labMeta[labType].icon}</span>
          <span className="mt-3 text-[15px] font-medium">{labMeta[labType].label}</span>
        </button>)}
      </div>
    </Modal>
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
