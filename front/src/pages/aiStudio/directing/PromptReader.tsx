import { useEffect, useRef, useState } from 'react'
import { Button, Drawer, Empty, Tag } from 'antd'
import type { Note_Input, Prompt, SceneDesign_Input, WorkspaceRead } from '../../../services/generated'
import { SourceLinks } from './Sources'
import { DesignNote } from './DesignNote'
import { designLabels } from './designLabels'
import { ReferencePreview } from './ReferencePreview'

/** 只解析冻结设计中的 JSON pointer，不把字段路径回跳到较新的编辑版本。 */
export function FrozenDesignValue({ design, pointer }: { design?: SceneDesign_Input; pointer: string }) {
  const value = pointer.startsWith('/') ? pointer.slice(1).split('/').reduce<unknown>((node, key) => node && typeof node === 'object' ? (node as Record<string, unknown>)[key.replace(/~1/g, '/').replace(/~0/g, '~')] : undefined, design) : undefined
  return <div className="frozen-design-value">{value === undefined ? <span>此快照中未找到该字段，请核对原路径。</span> : value && typeof value === 'object' && 'state' in value ? <><DesignNote note={value as Note_Input} /><SourceLinks sources={(value as Note_Input).sources || []} /></> : <pre>{typeof value === 'object' ? JSON.stringify(value, null, 2) : String(value)}</pre>}</div>
}

/** 正文片段与原编译映射一起阅读；文字重叠时展示所有关联决定，不推断来源。 */
export function PromptReader({ prompt, workspace, active = true, inline = false, paths }: { active?: boolean; prompt: Prompt; workspace: WorkspaceRead; inline?: boolean; paths?: string[] }) {
  const [selection, setSelection] = useState<number[]>()
  const reader = useRef<HTMLDivElement>(null)
  const mappingIdentity = JSON.stringify(prompt.decisions)
  useEffect(() => { if (paths?.length) { const frame = requestAnimationFrame(() => reader.current?.querySelector('.is-highlighted')?.scrollIntoView({ block: 'nearest' })); return () => cancelAnimationFrame(frame) } }, [paths, selection])
  useEffect(() => { if (inline) setSelection(paths ? prompt.decisions.flatMap((row, index) => paths.some(path => row.section_path === path || row.section_path.startsWith(path + '/') || path.startsWith(row.section_path + '/')) ? [index] : []) : undefined) }, [inline, paths, mappingIdentity])
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
  const details = <>
      <p>固定计划：{plan ? `计划 ${workspace.plans.indexOf(plan)+1}` : '缺失计划'} · 单元 {unit && plan ? plan.content.units.indexOf(unit) + 1 : '不可用'} · {design ? `设计 ${workspace.designs.indexOf(design)+1}` : '缺失设计'}</p>
      {!selection?.length && <Empty description={paths ? "这些问题字段没有可准确对应的编译映射；请核对原固定依据。" : "此指令没有提供编译映射"} />}
      {selection?.map(index => { const decision = prompt.decisions[index]; const reference = unit?.references.find(row => row.id === decision.reference_id); return <section className="prompt-decision" key={index}><Tag>{labels[decision.disposition]}</Tag><h3>{decision.section_path.split('/').filter(Boolean).map(key => /^\d+$/.test(key) ? `第${Number(key) + 1}项` : designLabels[key] || '未识别字段').join(' · ')}</h3><details><summary>原始字段路径</summary><code>{decision.section_path}</code></details>{decision.text_excerpt && <blockquote>{decision.text_excerpt}</blockquote>}<p>{decision.explanation}</p><FrozenDesignValue design={design?.content} pointer={decision.section_path} />{decision.reference_id && (reference ? <ReferencePreview reference={reference} /> : <p>引用参考在此冻结单元中缺失。</p>)}</section> })}
      <h3>完整指令来源</h3><SourceLinks sources={prompt.sources} />
  </>
  return <section className="production-instruction"><h2>完整生成指令</h2><p className="design-secondary">点击有下划线的片段查看其冻结依据。</p><div className="prompt-reader" ref={reader}>{points.slice(0,-1).map((start, index) => { const end = points[index+1]; const matches = ranges.filter(row => row.start <= start && row.end >= end).map(row => row.index); return matches.length ? <button className={selection?.some(index => matches.includes(index)) ? 'is-highlighted' : undefined} key={start} onClick={() => setSelection(matches)}>{prompt.text.slice(start,end)}</button> : <span key={start}>{prompt.text.slice(start,end)}</span> })}</div>
    <Button onClick={() => setSelection(prompt.decisions.map((_,i) => i))}>完整编译来源与去向 · {prompt.decisions.length}</Button>
    {inline ? selection && <section className="prompt-inline-evidence" aria-label="指令固定依据"><Button onClick={() => setSelection(undefined)}>收起固定依据</Button>{details}</section> : <Drawer title="生成指令的冻结依据" width={560} open={!!selection} onClose={() => setSelection(undefined)}>
      {details}
    </Drawer>}
  </section>
}
