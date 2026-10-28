import { useState } from 'react'
import { Alert, Input, InputNumber, Space } from 'antd'
import type { CreativeBasisCard, TextContentCard } from '../../../services/generated'

type TextCard = TextContentCard | CreativeBasisCard

/** 正文导入是一次明确编辑，来源定位保留在本卡，不建立持续输入。 */
export function TextContentEditor({ card, disabled, onChange }: { card: TextCard; disabled?: boolean; onChange: (card: TextCard) => void }) {
  const [error, setError] = useState('')
  const basis = card.type === 'content.basis' ? card as CreativeBasisCard : undefined
  const origin = 'origin' in card ? card.origin : undefined
  return <>
    {origin && <p>来自运行 {origin.run_id} · {origin.incomplete ? '未完成成果副本' : '完整成果副本'}</p>}
    <label>导入文本文件<input type="file" aria-label="导入文本文件" accept="text/plain,text/markdown,.txt,.md" disabled={disabled}
      onChange={event => {
        const file = event.target.files?.[0]
        event.target.value = ''
        if (!file) return
        void file.text().then(text => {
          setError('')
          onChange(basis ? { ...basis, text, source_locator: file.name, selection_start: 0, selection_end: text.length } : { ...card, text })
        }).catch(() => setError('文本文件读取失败，原内容已保留'))
      }} /></label>
    {error && <Alert type="error" message={error} />}
    {basis && <Space direction="vertical">
      <Input aria-label="依据来源定位" value={basis.source_locator || ''} disabled={disabled} onChange={event => onChange({ ...basis, source_locator: event.target.value })} />
      <Space wrap><InputNumber aria-label="原文选取起点" min={0} value={basis.selection_start} disabled={disabled} onChange={selection_start => onChange({ ...basis, selection_start })} />
        <InputNumber aria-label="原文选取终点" min={0} value={basis.selection_end} disabled={disabled} onChange={selection_end => onChange({ ...basis, selection_end })} /></Space>
    </Space>}
    <Input.TextArea aria-label={basis ? '创作依据正文' : '文本内容'} value={card.text} disabled={disabled} rows={6} onChange={event => onChange({ ...card, text: event.target.value })} />
  </>
}
