import { useEffect, useState, type ReactElement } from 'react'
import { Button, Drawer, Grid, Modal, Popover, Select } from 'antd'

/** 只编辑本场关联；替换前确认参考清除，失败保留选择供重试。 */
export function ObjectAssociationEditor({ assetId, hasReference, disabled, options, onSave, open, onClose, anchor }: {
  open: boolean; onClose: () => void; anchor: ReactElement
  assetId?: string | null; hasReference: boolean; disabled: boolean
  options: { value: string; label: string }[]
  onSave: (id?: string) => Promise<boolean>
}) {
  const mobile = !Grid.useBreakpoint().md
  const [value, setValue] = useState<string>()
  const [pending, setPending] = useState(false)
  const [failed, setFailed] = useState(false)
  const [confirming, setConfirming] = useState(false)
  useEffect(() => {
    if (open) { setValue(assetId ?? undefined); setFailed(false) }
  }, [open, assetId])
  useEffect(() => {
    if (!open) return
    const escape = (event: KeyboardEvent) => {
      if (event.key !== 'Escape' || pending || confirming) return
      event.preventDefault(); event.stopPropagation()
      onClose()
    }
    document.addEventListener('keydown', escape, true)
    return () => document.removeEventListener('keydown', escape, true)
  }, [open, pending, confirming, onClose])
  const close = () => { if (!pending && !confirming) { onClose() } }
  const submit = async (id?: string) => {
    setPending(true); setFailed(false)
    try {
      if (await onSave(id)) { onClose() }
      else setFailed(true)
    } finally { setPending(false) }
  }
  const select = (id?: string) => {
    setValue(id); setFailed(false)
    if (id === (assetId ?? undefined)) return
    if (hasReference) setConfirming(true)
    else void submit(id)
  }
  const content = <div className="object-association-editor" onKeyDown={event => { if (event.key === 'Escape') { event.stopPropagation(); close() } }}>
    <Select aria-label="关联资产" showSearch optionFilterProp="label" allowClear placeholder="搜索并选择资产"
      value={value} options={options} disabled={pending || disabled} onChange={select} />
    {failed && <Button disabled={pending} onClick={() => void submit(value)}>重试关联</Button>}
  </div>
  return <>
    {mobile ? anchor : <Popover trigger="click" placement="bottomLeft" open={open} title="关联资产" content={content}
      onOpenChange={next => { if (!next) close() }}>{anchor}</Popover>}
    {mobile && <Drawer aria-label="关联资产" title="关联资产" placement="bottom" height="min(360px, 80dvh)" open={open}
      closable={!pending} maskClosable={!pending} keyboard={!pending} onClose={close}>{content}</Drawer>}
    <Modal title="确认修改关联" open={confirming} okText="确认修改" cancelText="保留原关联"
      onCancel={() => { setConfirming(false); setValue(assetId ?? undefined) }}
      onOk={() => { setConfirming(false); void submit(value) }}>
      更换或解除关联将清除本场已选参考图，需要重新选择。不会删除资产或图片，也不改变各画布已采用的参考。
    </Modal>
  </>
}
