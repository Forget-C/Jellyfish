import { useEffect, useRef, useState } from 'react'
import { Alert, Button, Card, Empty, Input, Popconfirm, Select, Space, Typography } from 'antd'
import { useSearchParams } from 'react-router-dom'
import { ApiError, StudioGenerationCanvasesService as Canvases } from '../../../services/generated'
import type { CanvasDocument, CanvasRead, CanvasSave } from '../../../services/generated'
import { rendererRegistry } from './rendererRegistry'

/** 项目级文档编辑；运行、结果和浏览器布局有独立生命周期。 */
export function GenerationCanvasPage({ projectId }: { projectId: string }) {
  const [search, setSearch] = useSearchParams()
  const canvasId = search.get('canvas')
  const [canvases, setCanvases] = useState<CanvasRead[]>([])
  const [current, setCurrent] = useState<CanvasRead>()
  const [document, setDocument] = useState<CanvasDocument>()
  const [saving, setSaving] = useState(false)
  const [error, setError] = useState('')
  const [saved, setSaved] = useState(false)
  const pending = useRef<CanvasSave>()

  const fail = (reason: unknown) => {
    const detail = reason instanceof ApiError ? reason.body?.detail : undefined
    setError(detail?.code ? `${detail.code}: ${detail.message}` : '操作失败，请重试')
  }
  const refreshList = () => Canvases.canvasList({ projectId }).then(response => setCanvases(response.data || []))
  const select = (id?: string) => setSearch(previous => {
    const next = new URLSearchParams(previous)
    if (id) next.set('canvas', id)
    else next.delete('canvas')
    return next
  })
  useEffect(() => {
    let active = true
    Canvases.canvasList({ projectId }).then(response => { if (active) setCanvases(response.data || []) }).catch(fail)
    return () => { active = false }
  }, [projectId])
  useEffect(() => {
    let active = true
    setCurrent(undefined); setDocument(undefined); setError(''); setSaved(false); pending.current = undefined
    if (canvasId) Canvases.canvasGet({ projectId, canvasId }).then(response => {
      if (active && response.data) { setCurrent(response.data); setDocument(response.data.document) }
    }).catch(reason => { if (active) fail(reason) })
    return () => { active = false }
  }, [projectId, canvasId])

  const edit = (next: CanvasDocument) => { setDocument(next); setSaved(false) }
  const save = async () => {
    if (!document || !current || saving) return
    const command = pending.current || { request_id: crypto.randomUUID(), expected_revision: current.revision, document }
    pending.current = command
    setSaving(true); setError('')
    try {
      const response = await Canvases.canvasSave({ projectId, canvasId: current.id, requestBody: command })
      if (!response.data) throw new Error('missing receipt')
      pending.current = undefined
      setCurrent({ ...current, revision: response.data.revision, document: command.document as CanvasDocument })
      setSaved(command.document === document)
      await refreshList()
    } catch (reason) {
      // 明确未提交的校验/冲突允许修正；结果未知须保留原请求核实。
      if (reason instanceof ApiError && reason.status >= 400 && reason.status < 500) pending.current = undefined
      fail(reason)
    } finally { setSaving(false) }
  }
  const create = async () => {
    try {
      const response = await Canvases.canvasCreate({ projectId, requestBody: { name: '未命名画布' } })
      await refreshList()
      if (response.data) select(response.data.id)
    } catch (reason) { fail(reason) }
  }
  const remove = async () => {
    if (!current) return
    try {
      await Canvases.canvasDelete({ projectId, canvasId: current.id })
      select(); await refreshList()
    } catch (reason) { fail(reason) }
  }

  return <Space direction="vertical" size="middle" style={{ width: '100%' }}>
    <Space wrap>
      <Typography.Title level={4} style={{ margin: 0 }}>画布生成</Typography.Title>
      <Select aria-label="选择画布" placeholder="选择画布" value={canvasId || undefined} style={{ width: 220 }}
        disabled={saving} options={canvases.map(item => ({ value: item.id, label: item.document.name }))} onChange={select} />
      <Button onClick={create} disabled={saving}>新建画布</Button>
    </Space>
    {error && <Alert type="error" showIcon message={error} />}
    {!document || !current ? <Empty description="创建或选择一张画布" /> : <>
      <Space wrap>
        <Input aria-label="画布名称" value={document.name} maxLength={255} disabled={saving}
          onChange={event => edit({ ...document, name: event.target.value })} />
        <Button onClick={() => edit({ ...document, cards: [...(document.cards || []), {
          id: crypto.randomUUID(), type: 'content.text', type_version: 1, text: '',
        }] })} disabled={saving}>添加文本卡</Button>
        <Button type="primary" onClick={save} loading={saving}>保存画布</Button>
        <Popconfirm title="删除这张画布？" onConfirm={remove}><Button danger disabled={saving}>删除画布</Button></Popconfirm>
        <span role="status">revision {current.revision} · {saving ? '保存中' : saved ? '已保存' : '手动保存'}</span>
      </Space>
      <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fill, minmax(300px, 1fr))', gap: 16 }}>
        {(document.cards || []).map(card => {
          const Renderer = rendererRegistry[card.type || 'content.text']
          return <Card key={card.id} title="文本内容卡" data-card-id={card.id}>
            <Renderer card={card} onChange={next => edit({ ...document, cards: document.cards?.map(item => item.id === next.id ? next : item) })} />
          </Card>
        })}
      </div>
    </>}
  </Space>
}
