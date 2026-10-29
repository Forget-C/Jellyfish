import { useId, useRef, useState } from 'react'
import { Alert, Input, InputNumber, Space } from 'antd'
import { UploadOutlined } from '@ant-design/icons'
import { WorkbenchButton } from '../directing/ui/WorkbenchButton'
import type { CreativeBasisCard, TextContentCard } from '../../../services/generated'
import './textContentEditor.css'

type TextCard = TextContentCard | CreativeBasisCard

/** 正文导入是一次明确编辑，来源定位保留在本卡，不建立持续输入。 */
export function TextContentEditor({ card, disabled, onChange }: { card: TextCard; disabled?: boolean; onChange: (card: TextCard) => void }) {
  const input = useRef<HTMLInputElement>(null)
  const bodyId = useId()
  const [error, setError] = useState('')
  const [importedName, setImportedName] = useState('')
  const [reading, setReading] = useState(false)
  const basis = card.type === 'content.basis' ? card as CreativeBasisCard : undefined
  const origin = 'origin' in card ? card.origin : undefined
  return <div className="generation-text-content-editor">
    {origin && <p>来自运行 {origin.run_id} · {origin.incomplete ? '未完成成果副本' : '完整成果副本'}</p>}
    <input ref={input} hidden type="file" aria-label="文本文件选择" accept="text/plain,text/markdown,.txt,.md" disabled={disabled || reading}
      onChange={event => {
        const file = event.target.files?.[0]
        event.target.value = ''
        if (!file) return
        setReading(true); setError('')
        void file.text().then(text => {
          setImportedName(file.name)
          setError('')
          onChange(basis ? { ...basis, text, source_locator: file.name, selection_start: 0, selection_end: text.length } : { ...card, text })
        }).catch(() => setError('文本文件读取失败，原内容已保留')).finally(() => setReading(false))
      }} />
    {error && <Alert type="error" message={error} />}
    {basis && <Space direction="vertical">
      <Input aria-label="依据来源定位" value={basis.source_locator || ''} disabled={disabled} onChange={event => onChange({ ...basis, source_locator: event.target.value })} />
      <Space wrap><InputNumber aria-label="原文选取起点" min={0} value={basis.selection_start} disabled={disabled} onChange={selection_start => onChange({ ...basis, selection_start })} />
        <InputNumber aria-label="原文选取终点" min={0} value={basis.selection_end} disabled={disabled} onChange={selection_end => onChange({ ...basis, selection_end })} /></Space>
    </Space>}
    <label htmlFor={bodyId}>正文</label>
    <textarea id={bodyId} placeholder="记录一段文字，或导入已有文本。这里的内容可由模型独立采用。" aria-label={basis ? '创作依据正文' : '文本内容'} value={card.text || ''} readOnly={disabled} aria-readonly={disabled} rows={6} onChange={event => onChange({ ...card, text: event.target.value })} />
    <footer>
      <span className="generation-text-count">{(card.text || '').length} 字</span>
      {disabled && <small>只读 · 内容可查看，暂不可修改</small>}
      <Space wrap><WorkbenchButton icon={<UploadOutlined />} disabled={disabled || reading} loading={reading} onClick={() => input.current?.click()}>导入文本文件</WorkbenchButton>
        <small className="generation-import-status" role="status">{reading ? '正在读取文本文件…' : importedName ? `已导入：${importedName}` : '支持 TXT、Markdown'}</small>
      </Space>
    </footer>
  </div>
}
