import { useEffect, useRef, useState } from 'react'
import { Button, Card, Space, Typography } from 'antd'
import { SourceLinks } from './Sources'
import { FrozenDesignValue } from './PromptReader'
import type { Note_Output, ReviewRow, SceneDesign_Input } from '../../../services/generated'
import { readableContext, readablePath } from './readableText'
import type { ReadableContext, ReadableSegment } from './readableText'
import { ReadableText, ReadableDetails } from './ReadableContent'

/** 使用原字段的层级与位置命名，不将未知路径映射到相似对象。 */
export function reviewPathLabel(path: string, context: ReadableContext = readableContext()) { return readablePath(path, context) }

const states = { unset: '未填写', unknown: '待确定', not_applicable: '不适用', none: '明确没有', fact: '已知事实', proposal: '建议' }

/** 原样呈现已保存的状态和来源，不将缺失信息补成事实或人工批准。 */
function ReviewNote({ label, note, context, onInspect }: { label: string; note: Note_Output; context: ReadableContext; onInspect: (part: ReadableSegment) => void }) {
  return <div>
    <Typography.Text strong>{label} · {states[note.state || 'unset']}</Typography.Text>
    <p style={{ whiteSpace: 'pre-wrap' }}><ReadableText text={note.text || note.reason || '未提供内容'} context={context} onInspect={onInspect} /></p>
    {note.sources?.length ? <SourceLinks sources={note.sources} /> : <Typography.Text type="secondary">未提供来源</Typography.Text>}
  </div>
}

/** 审稿结果、执行取舍和台账共用详情；字段路径仅展示，不猜测或跳转设计版本。 */
export function ReviewDetails({ row, design, context: suppliedContext, compact = false, hideRationale = false, onInspect }: { row: ReviewRow; design?: SceneDesign_Input; context?: ReadableContext; compact?: boolean; hideRationale?: boolean; onInspect?: (paths: string[]) => void }) {
  const context = suppliedContext || readableContext(design)
  const [part, setPart] = useState<ReadableSegment>()
  const identity = JSON.stringify([row, context.identity || context.design])
  useEffect(() => { setPart(undefined) }, [identity])
  const trigger = useRef<HTMLElement>()
  const evidence = useRef<HTMLElement>(null)
  const inspect = (next: ReadableSegment) => { trigger.current = document.activeElement instanceof HTMLElement ? document.activeElement : undefined; setPart(next); requestAnimationFrame(() => evidence.current?.focus()) }
  const text = (value: string) => <ReadableText text={value} context={context} onInspect={inspect} />
  const details = <>
    {part && <section className="prompt-inline-evidence" aria-label="检查对象详情" ref={evidence} tabIndex={-1}><Button onClick={() => { setPart(undefined); requestAnimationFrame(() => trigger.current?.isConnected && trigger.current.focus()) }}>收起对象详情</Button><p>{context.snapshotLabel || '来自本条检查的固定设计；缺失对象保留原文。'}</p><ReadableDetails part={part} context={context} /></section>}
    <details className="review-raw"><summary>展开原始记录</summary><pre>{JSON.stringify(row, null, 2)}</pre></details>
  </>
  if (compact) return <div className="shoot-review-findings">
    {!hideRationale && <p>{text(row.rationale || '未提供结论说明')}</p>}
    {row.findings.map((finding, index) => <section key={index}>
      <p><strong>观察{row.findings.length > 1 ? ` ${index + 1}` : ''}：</strong>{text(finding.observation || '未提供观察内容')}</p>
      <p><strong>建议：</strong>{text(finding.suggestion.text || finding.suggestion.reason || '未提供修改建议')}<small> · {states[finding.suggestion.state || 'unset']}</small></p>
      <p><strong>验收条件：</strong>{text(finding.acceptance.text || finding.acceptance.reason || '未提供验收条件')}<small> · {states[finding.acceptance.state || 'unset']}</small></p>
      <details><summary>影响位置与来源</summary><ReviewNote label="修改建议" note={finding.suggestion} context={context} onInspect={inspect} /><ReviewNote label="验收条件" note={finding.acceptance} context={context} onInspect={inspect} />
        {finding.affected_paths.map((path, i) => <details key={i}><summary>{reviewPathLabel(path, context)}</summary><FrozenDesignValue design={context.design} pointer={path} /><code>{path}</code></details>)}
        {!finding.affected_paths.length && <p>未指定影响对象</p>}
      </details>
      {!!finding.affected_paths.length && onInspect && <button type="button" className="shoot-text-action" onClick={() => onInspect(finding.affected_paths)}>查看相关指令与固定依据</button>}
    </section>)}
    {!row.findings.length && <p className="design-secondary">未提供具体问题详情，结论以原检查状态为准。</p>}
    {details}
  </div>
  return <>
    <p style={{ whiteSpace: 'pre-wrap' }}>{text(row.rationale)}</p>
    {row.findings.length ? <details><summary>查看问题详情（{row.findings.length}）</summary>
      <Space direction="vertical" className="w-full">{row.findings.map((finding, index) => <Card key={index} size="small" title={`问题 ${index + 1}`}>
        <Typography.Text strong>观察</Typography.Text><p style={{ whiteSpace: 'pre-wrap' }}>{text(finding.observation)}</p>
        <Typography.Text strong>影响位置</Typography.Text>
        {finding.affected_paths.length ? <ul>{finding.affected_paths.map((path, i) => <li key={i}><details><summary><Typography.Text>{reviewPathLabel(path, context)}</Typography.Text></summary>{context.design ? <FrozenDesignValue design={context.design} pointer={path} /> : <p>此处仅展示审稿原始路径，未载入对应冻结设计。</p>}</details></li>)}</ul> : <p>未指定影响对象</p>}
        <ReviewNote label="修改建议" note={finding.suggestion} context={context} onInspect={inspect} />
        <ReviewNote label="验收条件" note={finding.acceptance} context={context} onInspect={inspect} />
      </Card>)}</Space>
    </details> : <Typography.Text type="secondary">本项未列出具体问题；结论以审稿状态为准。</Typography.Text>}
    {details}
  </>
}
