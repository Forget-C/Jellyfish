import { WorkbenchDetails, useWorkbenchDetailsAvailable } from './ui/WorkbenchDetails'
import { WorkbenchReadingContext } from './ui/WorkbenchReadingContext'
import { useContext, useEffect, useRef, useState } from 'react'
import { Button, Drawer, Empty, Radio, Tag } from 'antd'
import type { Note_Input, Prompt, SceneDesign_Input, WorkspaceRead } from '../../../services/generated'
import { SourceLinks } from './Sources'
import { DesignNote } from './DesignNote'
import { readableContext, readablePath, readableSegments, decisionRanges, fixedValue } from './readableText'
import type { ReadableSegment } from './readableText'
import { ReadableText, ReadableDetails } from './ReadableContent'
import { ReferencePreview } from './ReferencePreview'

/** 只解析冻结设计中的 JSON pointer，不把字段路径回跳到较新的编辑版本。 */
export function FrozenDesignValue({ design, pointer }: { design?: SceneDesign_Input; pointer: string }) {
  const value = fixedValue(design, pointer)
  return <div className="frozen-design-value">{value === undefined ? <span>此快照中未找到该字段，请核对原路径。</span> : value && typeof value === 'object' && 'state' in value ? <><DesignNote note={value as Note_Input} /><SourceLinks sources={(value as Note_Input).sources || []} /></> : <pre>{typeof value === 'object' ? JSON.stringify(value, null, 2) : String(value)}</pre>}</div>
}

/** 正文片段与原编译映射一起阅读；文字重叠时展示所有关联决定，不推断来源。 */
export function PromptReader({ prompt, workspace, active = true, inline = false, paths, onEdit }: { active?: boolean; prompt: Prompt; workspace: WorkspaceRead; inline?: boolean; paths?: string[]; onEdit?: (paths: string[]) => void }) {
  const withinReader = useContext(WorkbenchReadingContext)
  const workbench = useWorkbenchDetailsAvailable()
  const [selection, setSelection] = useState<number[]>()
  const [part, setPart] = useState<ReadableSegment>()
  const [view, setView] = useState<'readable' | 'raw'>('readable')
  const [copyState, setCopyState] = useState('')
  const trigger = useRef<HTMLElement>()
  const evidence = useRef<HTMLElement>(null)
  const close = () => { setSelection(undefined); setPart(undefined); requestAnimationFrame(() => trigger.current?.isConnected && trigger.current.focus()) }
  const inspect = (next: ReadableSegment | undefined, decisions: number[]) => { trigger.current = document.activeElement instanceof HTMLElement ? document.activeElement : undefined; setPart(next); setSelection(decisions); requestAnimationFrame(() => evidence.current?.focus()) }
  useEffect(() => { setCopyState('') }, [view, prompt.text])
  const reader = useRef<HTMLDivElement>(null)
  const mappingIdentity = JSON.stringify(prompt.decisions)
  useEffect(() => { setSelection(undefined); setPart(undefined); setView('readable') }, [prompt.text, prompt.plan_revision_id, prompt.unit_id, prompt.format_version, mappingIdentity])
  useEffect(() => { if (paths?.length) { const frame = requestAnimationFrame(() => reader.current?.querySelector('.is-highlighted')?.scrollIntoView({ block: 'nearest' })); return () => cancelAnimationFrame(frame) } }, [paths, selection])
  useEffect(() => { if (inline) { if (paths) { setView('readable'); setPart(undefined) }; setSelection(paths ? prompt.decisions.flatMap((row, index) => paths.some(path => row.section_path === path || row.section_path.startsWith(path + '/') || path.startsWith(row.section_path + '/')) ? [index] : []) : undefined) } }, [inline, paths, mappingIdentity])
  useEffect(() => { if (!active) { setSelection(undefined); setPart(undefined) } }, [active])
  const plan = workspace.plans.find(row => row.id === prompt.plan_revision_id)
  const unit = plan?.content.units.find(row => row.id === prompt.unit_id)
  const design = workspace.designs.find(row => row.id === plan?.content.design_revision_id)
  const context = readableContext(design?.content, unit)
  const ranges = decisionRanges(prompt.text, prompt.decisions)
  const compiled = prompt.format_version === 'jellyfish-scene-v4'
  const readable = readableSegments(prompt.text, context, { compiled })
  const copy = async () => {
    try { await navigator.clipboard.writeText(view === 'raw' ? prompt.text : readable.map(row => row.label).join('')); setCopyState('已复制') }
    catch { setCopyState('复制失败，请选择正文复制') }
  }
  const unmappedPaths = paths?.filter(path => !prompt.decisions.some(row => row.section_path === path || row.section_path.startsWith(path + '/') || path.startsWith(row.section_path + '/'))) || []
  const editPaths = part ? (selection || []).map(index => prompt.decisions[index].section_path) : paths || (selection || []).map(index => prompt.decisions[index].section_path)
  const labels = { text: '写入正文', reference: '由参考表达', equivalent: '等效表达', unexpressed: '未表达' }
  const details = <>
      <p>固定计划：{plan ? `计划 ${workspace.plans.indexOf(plan)+1}` : '缺失计划'} · 单元 {unit && plan ? plan.content.units.indexOf(unit) + 1 : '不可用'} · {design ? `设计 ${workspace.designs.indexOf(design)+1}` : '缺失设计'}</p>
      {part && <><ReadableDetails part={part} context={context} /><details><summary>原文片段</summary><pre>{prompt.text.slice(part.start, part.end)}</pre></details></>}
      {!part && !selection?.length && <Empty description={paths ? "这些问题字段没有可准确对应的编译映射；请核对原固定依据。" : "此指令没有提供编译映射"} />}
      {unmappedPaths.map(path => <section key={path}><h3>{readablePath(path, context)}</h3><code>{path}</code><FrozenDesignValue design={design?.content} pointer={path} /></section>)}
      {selection?.map(index => { const decision = prompt.decisions[index]; const reference = unit?.references.find(row => row.id === decision.reference_id); return <section className="prompt-decision" key={index}><Tag>{labels[decision.disposition]}</Tag><h3>{readablePath(decision.section_path, context)}</h3><details><summary>原始字段路径</summary><code>{decision.section_path}</code></details>{decision.text_excerpt && <blockquote>{decision.text_excerpt}</blockquote>}<p><ReadableText text={decision.explanation} context={context} /></p><FrozenDesignValue design={design?.content} pointer={decision.section_path} />{decision.reference_id && (reference ? <ReferencePreview reference={reference} /> : <p>引用参考在此冻结单元中缺失。</p>)}</section> })}
      {onEdit && (editPaths.length ? <Button onClick={() => onEdit(editPaths)}>修改这段对应内容</Button> : <><p>这段文字没有可准确对应的编辑字段，可描述希望如何调整。</p><Button onClick={() => onEdit([])}>说明希望怎么改</Button></>)}
      <h3>完整指令来源</h3><SourceLinks sources={prompt.sources} />
  </>
  return <section className="production-instruction"><h2>完整生成指令</h2>
    <div className="prompt-view-toolbar"><Radio.Group aria-label="指令展示方式" value={view} onChange={event => setView(event.target.value)} optionType="button" options={[{ label: '易读视图', value: 'readable' }, { label: '模型原文', value: 'raw' }]} /><Button onClick={() => { void copy() }}>{view === 'raw' ? '复制模型原文' : '复制易读内容'}</Button><span role="status">{copyState}</span></div>
    <p className="design-secondary">{view === 'readable' ? '名称和字段已转换；实际提交以模型原文为准。未识别的内容保留原文。' : '这是提交给模型的指令文本；图片与参数请查看固定输入。'}点击有下划线的片段查看固定依据。</p>
    <div className="prompt-reader" ref={reader}><ReadableText text={prompt.text} context={context} compiled={compiled} raw={view === 'raw'} ranges={ranges} selection={selection} onInspect={inspect} /></div>
    <Button onClick={() => inspect(undefined, prompt.decisions.map((_, i) => i))}>完整编译来源与去向 · {prompt.decisions.length}</Button>
    {inline || withinReader ? selection && <section ref={evidence} tabIndex={-1} className="prompt-inline-evidence" aria-label="指令固定依据"><Button onClick={close}>收起固定依据</Button>{details}</section> : workbench ? <WorkbenchDetails title="生成指令的冻结依据" status="只读" open={!!selection} onClose={close}>{details}</WorkbenchDetails> : <Drawer className="app-detail-drawer" title="生成指令的冻结依据" width={560} open={!!selection} onClose={close}>
      {details}
    </Drawer>}
  </section>
}
