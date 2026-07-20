/** Shared controls for selecting and creating experiment sessions. */
import { Button, Dropdown, Input, Modal, Select, message } from 'antd'
import { DeleteOutlined, EditOutlined, LoadingOutlined, MoreOutlined, PlusOutlined } from '@ant-design/icons'
import { useState } from 'react'
import type { ExperimentSessionRead } from '../../../../services/generated'

type ExperimentSessionControlsProps = {
  value?: string
  sessions: ExperimentSessionRead[]
  disabled?: boolean
  onChange: (sessionId: string) => void
  onCreate: () => void
  onRename?: (title: string) => Promise<void>
  onDelete?: () => Promise<void>
}

/** Keeps session selection and creation consistent across laboratory pages. */
export function ExperimentSessionControls({ value, sessions, disabled = false, onChange, onCreate, onRename, onDelete }: ExperimentSessionControlsProps) {
  const [renameOpen, setRenameOpen] = useState(false)
  const [title, setTitle] = useState('')
  const current = sessions.find((item) => item.id === value)
  const openRename = () => { setTitle(current?.title ?? ''); setRenameOpen(true) }
  const menuItems = [
    onRename ? { key: 'rename', icon: <EditOutlined />, label: '重命名', onClick: openRename } : null,
    onDelete ? { key: 'delete', danger: true, icon: <DeleteOutlined />, label: '删除', onClick: () => Modal.confirm({ title: '删除会话', content: '删除后无法恢复。', okButtonProps: { danger: true }, onOk: async () => { try { await onDelete() } catch { message.error('删除会话失败；运行中任务不可删除') } } }) } : null,
  ].filter(Boolean)
  /** 将时间压缩为会话选择器中易于扫读的本地显示格式。 */
  const formatUpdatedAt = (value: string) => new Intl.DateTimeFormat('zh-CN', {
    month: 'numeric', day: 'numeric', hour: '2-digit', minute: '2-digit', hour12: false,
  }).format(new Date(value))
  return <div className="flex items-center gap-2">
    <Select
      size="small"
      value={value}
      options={sessions.map((item) => ({
        value: item.id,
        label: <div className="min-w-0 py-0.5 leading-tight"><div className="flex items-center gap-1"><span className="truncate">{item.title}</span>{item.has_running_task ? <LoadingOutlined className="shrink-0 text-blue-500" title="生成中" /> : null}</div><div className="mt-0.5 truncate text-xs text-slate-400">{item.last_message_preview || '暂无消息'} · {formatUpdatedAt(item.updated_at)}</div></div>,
      }))}
      optionLabelProp="label"
      onChange={onChange}
      className="w-56"
      disabled={disabled}
    />
    <Button size="small" icon={<PlusOutlined />} onClick={onCreate} disabled={disabled}>新建</Button>
    {(onRename || onDelete) ? <Dropdown menu={{ items: menuItems }}><Button size="small" icon={<MoreOutlined />} disabled={disabled} /></Dropdown> : null}
    <Modal title="重命名会话" open={renameOpen} onCancel={() => setRenameOpen(false)} onOk={async () => { if (!title.trim() || !onRename) return; await onRename(title.trim()); setRenameOpen(false) }}>
      <Input value={title} onChange={(event) => setTitle(event.target.value)} maxLength={255} autoFocus />
    </Modal>
  </div>
}
