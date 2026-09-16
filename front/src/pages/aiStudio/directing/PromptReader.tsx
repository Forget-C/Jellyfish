import { useEffect, useState } from 'react'
import { Button, Drawer, Empty, Tag } from 'antd'
import type { Note_Input, Prompt, SceneDesign_Input, WorkspaceRead } from '../../../services/generated'
import { SourceLinks } from './Sources'
import { DesignNote } from './DesignNote'
import { ReferencePreview } from './ReferencePreview'

/** 只解析冻结设计中的 JSON pointer，不把字段路径回跳到较新的编辑版本。 */
export function FrozenDesignValue({ design, pointer }: { design?: SceneDesign_Input; pointer: string }) {
  const value = pointer.startsWith('/') ? pointer.slice(1).split('/').reduce<unknown>((node, key) => node && typeof node === 'object' ? (node as Record<string, unknown>)[key.replace(/~1/g, '/').replace(/~0/g, '~')] : undefined, design) : undefined
  return <div className="frozen-design-value">{value === undefined ? <span>此快照中未找到该字段，请核对原路径。</span> : value && typeof value === 'object' && 'state' in value ? <><DesignNote note={value as Note_Input} /><SourceLinks sources={(value as Note_Input).sources || []} /></> : <pre>{typeof value === 'object' ? JSON.stringify(value, null, 2) : String(value)}</pre>}</div>
}

/** 正文片段与原编译映射一起阅读；文字重叠时展示所有关联决定，不推断来源。 */
export function PromptReader({ prompt, workspace, active = true }: { active?: boolean; prompt: Prompt; workspace: WorkspaceRead }) {
  const [selection, setSelection] = useState<number[]>()
  useEffect(() => { if (!active) setSelection(undefined) }, [active])
  const plan = workspace.plans.find(row => row.id === prompt.plan_revision_id)
  const unit = plan?.content.units.find(row => row.id === prompt.unit_id)
  const design = workspace.designs.find(row => row.id === plan?.content.design_revision_id)
  const ranges = prompt.decisions.flatMap((decision, index) => {
    const excerpt = decision.text_excerpt
    if (!excerpt) return []
    const matches: Array<{ start: number; end: number; index: number }> = []
    let start = prompt.text.indexOf(excerpt)
    while (start >= 0) { matches.push({ start, end: start + excerpt.length, index }); start = prompt.text.indexOf(excerpt, start + excerpt.length) }
    return matches
  })
  const points = [...new Set([0, prompt.text.length, ...ranges.flatMap(row => [row.start,row.end])])].sort((a,b) => a-b)
  const labels = { text: '写入正文', reference: '由参考表达', equivalent: '等效表达', unexpressed: '未表达' }
  return <section className="production-instruction"><h2>完整生成指令</h2><p className="design-secondary">点击有下划线的片段查看其冻结依据。</p><div className="prompt-reader">{points.slice(0,-1).map((start, index) => { const end = points[index+1]; const matches = ranges.filter(row => row.start <= start && row.end >= end).map(row => row.index); return matches.length ? <button key={start} onClick={() => setSelection(matches)}>{prompt.text.slice(start,end)}</button> : <span key={start}>{prompt.text.slice(start,end)}</span> })}</div>
    <Button onClick={() => setSelection(prompt.decisions.map((_,i) => i))}>完整编译来源与去向 · {prompt.decisions.length}</Button>
    <Drawer title="生成指令的冻结依据" width={560} open={!!selection} onClose={() => setSelection(undefined)}>
      <p>固定计划：{plan ? `计划 ${workspace.plans.indexOf(plan)+1}` : '缺失计划'} · 单元 {unit?.id || '缺失'} · {design ? `设计 ${workspace.designs.indexOf(design)+1}` : '缺失设计'}</p>
      {!selection?.length && <Empty description="此指令没有提供编译映射" />}
      {selection?.map(index => { const decision = prompt.decisions[index]; const reference = unit?.references.find(row => row.id === decision.reference_id); return <section className="prompt-decision" key={index}><Tag>{labels[decision.disposition]}</Tag><h3>{decision.section_path}</h3>{decision.text_excerpt && <blockquote>{decision.text_excerpt}</blockquote>}<p>{decision.explanation}</p><FrozenDesignValue design={design?.content} pointer={decision.section_path} />{decision.reference_id && (reference ? <ReferencePreview reference={reference} /> : <p>引用参考在此冻结单元中缺失。</p>)}</section> })}
      <h3>完整指令来源</h3><SourceLinks sources={prompt.sources} />
    </Drawer>
  </section>
}
