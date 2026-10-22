import { useState } from 'react'
import { createPortal } from 'react-dom'
import { WorkbenchButton as Button } from './ui/WorkbenchButton'
import { ApartmentOutlined, CloseOutlined } from '@ant-design/icons'
import { CanvasTextPreview } from './CanvasTextPreview'
import { SceneWorkbenchOverview } from './SceneWorkbenchOverview'
import { SceneRelationDetails } from './SceneRelationDetails'
import type { SceneInspectionTarget } from './SceneRelationDetails'
import type { SceneTakeLibraryRead, SceneVersionContent_Output, SceneVersionRead, EditTakeCanvasNode, EditClipCanvasNode, EditPlannedCanvasNode, UnitCanvasNode, InstructionCanvasNode } from '../../../services/generated'

export type SceneMediaNavigationTarget = { kind: 'take'; takeKind: SceneTakeLibraryRead['take_kind']; takeId: string; focusCoverage?: boolean } | { kind: 'clip'; clipId: string }
export type SceneNavigationTarget = SceneMediaNavigationTarget | { kind: 'shot'; shotId: string } | { kind: 'unit' | 'instruction'; shotId?: string; unitId: string }

/** 关系树使用当前版本对象身份；展开仅改变导航展示，名称才定位业务对象。 */
export function SceneRelationsNavigation({ triggerHost, open, onOpenChange: setOpen, projectId, sequenceId, versionId, snapshot, evidenceError, onRefreshGraph, content, shotId, unitId, canvas, onNavigate }: {
  triggerHost: HTMLElement | null
  open: boolean; onOpenChange: (open: boolean) => void
  projectId: string; sequenceId: string; versionId: string
  snapshot: SceneVersionRead; evidenceError: string; onRefreshGraph: () => void; content: SceneVersionContent_Output; shotId?: string; unitId?: string; canvas: string
  onNavigate: (target: SceneNavigationTarget) => void
}) {
  const [expanded, setExpanded] = useState<Record<string, boolean>>({})
  const [overview, setOverview] = useState(false)
  const [inspection, setInspection] = useState<SceneInspectionTarget>()
  if (!snapshot.unit_graph || !snapshot.instruction_graph || !snapshot.edit_graph) return triggerHost ? createPortal(<p role="alert">关系图暂不可用；当前编辑内容已保留，请重新读取版本。<Button onClick={onRefreshGraph}>重新读取关系图</Button></p>, triggerHost) : null
  const takes = snapshot.edit_graph.nodes.filter((node): node is EditTakeCanvasNode => node.kind === 'edit_take')
  const clips = snapshot.edit_graph.nodes.filter((node): node is EditClipCanvasNode | EditPlannedCanvasNode => node.kind === 'edit_clip' || node.kind === 'edit_planned')
  const units = snapshot.unit_graph.nodes.filter((node): node is UnitCanvasNode => node.kind === 'unit')
  const instructions = snapshot.instruction_graph.nodes.filter((node): node is InstructionCanvasNode => node.kind === 'instruction')
  const pending = content !== snapshot.content && JSON.stringify(content) !== JSON.stringify(snapshot.content)
  const navigate = (target: SceneNavigationTarget) => {
    onNavigate(target)
    if (window.innerWidth < 760) setOpen(false)
  }
  const toggle = (key: string) => setExpanded(previous => ({ ...previous, [key]: !previous[key] }))
  return <>{triggerHost && createPortal(<nav className="scene-relations-tree" data-open={open} aria-label="场次关系树" onKeyDown={event => { if (event.key === 'Escape' && open) { event.stopPropagation(); setOpen(false) } }}>
    <Button aria-expanded={open} className="scene-relations-toggle" aria-label={open ? '收起关系树' : '展开关系树'} title={open ? '收起关系树' : '展开关系树'} icon={open ? <CloseOutlined /> : <ApartmentOutlined />} onClick={() => setOpen(!open)} />
    {open && <div hidden={!!inspection || overview} className="scene-relations-tree-content"><h2>场次关系</h2>{pending && <p role="status">图为已保存关系，当前编辑待同步；新增对象请在原编辑入口操作。</p>}
      <Button onClick={() => setOverview(true)}>展开全图</Button>
      <Button onClick={onRefreshGraph}>{evidenceError ? '重试关系图证据' : '刷新关系图证据'}</Button>
      {evidenceError && <p role="alert">关系图证据读取失败，保留旧摘要：{evidenceError}</p>}
      <ul aria-label="全场共享对象">
        <li><Button variant="quiet" onClick={() => setInspection({ kind: 'basis' })}>查看版本原文依据</Button></li>
        <li><Button variant="quiet" onClick={() => setInspection({ kind: 'shared' })}>查看全场共享设计</Button></li>
        <li><Button variant="quiet" onClick={() => setInspection({ kind: 'location' })}>查看本场场所</Button></li>
        {content.design.participants.map(person => <li key={person.id}><Button variant="quiet" aria-label={`查看参与对象：${person.name}`} onClick={() => setInspection({ kind: 'participant', id: person.id })}>{person.name} · 参与对象</Button></li>)}
      </ul>
      {!content.design.direction.shots.length && <p>当前版本尚无镜头</p>}
      <ul>{content.design.direction.shots.map((shot, index) => {
        const key = `shot:${shot.id}`
        const shotNode = snapshot.unit_graph.nodes.find(node => node.kind === 'shot_basis' && node.shot_id === shot.id)
        const linkedUnits = units.filter(unit => snapshot.unit_graph.edges.some(edge => edge.kind === 'business' && edge.source === shotNode?.id && edge.target === unit.id))
        return <li key={shot.id}>
          <div className="scene-relations-tree-row">
            <Button aria-label={`${expanded[key] ? '收起' : '展开'}镜头 ${index + 1}`} aria-expanded={!!expanded[key]} onClick={() => toggle(key)}>{expanded[key] ? '▾' : '▸'}</Button>
            <Button variant="quiet" aria-label={`定位镜头 ${index + 1}：${shot.visible_result.text || '未填写'}`} aria-current={shotId === shot.id && canvas === 'director' ? 'location' : undefined}
              onClick={() => navigate({ kind: 'shot', shotId: shot.id })}>镜头 {index + 1} · {shot.visible_result.text || '未填写'}</Button>
          </div>
          {expanded[key] && <ul aria-label={`镜头 ${index + 1} 的关联单元`}>
            {!linkedUnits.length && <li>尚无关联单元</li>}
            {linkedUnits.map(node => {
              const unit = content.units.find(unit => unit.id === node.unit_id)
              if (!unit) return <li key={node.id}>原单元已在当前编辑中移除，图待同步</li>
              const instruction = instructions.find(row => row.unit_id === node.unit_id)
              const references = snapshot.instruction_graph.nodes.find(row => row.kind === 'unit_references' && row.unit_id === node.unit_id)
              const number = node.number
              const unitKey = `${key}:unit:${unit.id}`
              const selected = shotId === shot.id && unitId === unit.id
              return <li key={unit.id}>
                <div className="scene-relations-tree-row">
                  <Button aria-label={`${expanded[unitKey] ? '收起' : '展开'}单元 ${number}`} aria-expanded={!!expanded[unitKey]} onClick={() => toggle(unitKey)}>{expanded[unitKey] ? '▾' : '▸'}</Button>
                  <Button variant="quiet" aria-label={`定位单元 ${number}：${node.preview_title}`} aria-current={selected && canvas === 'units' ? 'location' : undefined}
                    onClick={() => navigate({ kind: 'unit', shotId: shot.id, unitId: unit.id })}>单元 {number}：{node.preview_title}</Button>
                </div>
                {expanded[unitKey] && <ul><li><Button variant="quiet" aria-label={`定位单元 ${number} 的指令`} aria-current={selected && canvas === 'instructions' ? 'location' : undefined}
                  onClick={() => navigate({ kind: 'instruction', shotId: shot.id, unitId: unit.id })}>当前指令{instruction?.text.trim() ? '' : ' · 未填写'}</Button>{instruction?.summary.map(field => <CanvasTextPreview key={field.field} text={`${field.label}：${field.text}`} label={field.label} lines={2} />)}</li>
                  {(references?.kind === 'unit_references' ? references.bindings : []).map((reference, referenceIndex) => <li key={reference.id}><Button variant="quiet" aria-label={`查看单元 ${number} 参考 ${referenceIndex + 1}`}
                    onClick={() => setInspection({ kind: 'reference', unitId: unit.id, id: reference.id })}>参考 {referenceIndex + 1} · {reference.asset_origin?.name || reference.media_kind}</Button></li>)}
                </ul>}
              </li>
            })}
          </ul>}
        </li>
      })}</ul>
      {content.units.filter(unit => !units.some(node => node.unit_id === unit.id)).map(unit => <p key={unit.id}><Button variant="quiet" onClick={() => navigate({ kind: 'unit', unitId: unit.id })}>编辑待同步单元 {unit.id}</Button></p>)}
      <Button aria-expanded={!!expanded.takes} onClick={() => toggle('takes')}>{expanded.takes ? '收起同场次素材' : '展开同场次素材'}</Button>
      {expanded.takes && <section aria-label="关系树素材列表">
        {!takes.length && <p>本场暂无已登记素材</p>}
        <ul>{takes?.map((take, index) => <li key={`${take.take_kind}:${take.take_id}`}>
          <Button variant="quiet" aria-label={`定位源素材 ${index + 1}`}
            onClick={() => navigate({ kind: 'take', takeKind: take.take_kind, takeId: take.take_id })}>{take.title}</Button>{take.summary.map(field => <CanvasTextPreview key={field.field} text={`${field.label}：${field.text}`} label={field.label} lines={2} />)}
        </li>)}</ul>
      </section>}
      <Button aria-expanded={!!expanded.clips} onClick={() => toggle('clips')}>{expanded.clips ? '收起时间线片段' : '展开时间线片段'}</Button>
      {expanded.clips && <ul aria-label="关系树时间线片段">
        {!clips.length && <li>当前时间线为空</li>}
        {clips.map((clip, index) => <li key={clip.id}>
          <Button variant="quiet" aria-label={`定位片段 ${index + 1}`} onClick={() => navigate({ kind: 'clip', clipId: clip.clip_id })}>{clip.title}</Button>{clip.summary.map(field => <CanvasTextPreview key={field.field} text={`${field.label}：${field.text}`} label={field.label} lines={2} />)}
        </li>)}
      </ul>}
    </div>}
  </nav>, triggerHost)}
    {overview && <SceneWorkbenchOverview snapshot={snapshot} projectId={projectId} sequenceId={sequenceId} versionId={versionId} content={content} unitId={unitId} shotId={shotId} onNavigate={navigate} onClose={() => setOverview(false)} />}
    {inspection && <SceneRelationDetails key={JSON.stringify(inspection)} projectId={projectId} content={content} target={inspection} onClose={() => setInspection(undefined)} />}
  </>
}
