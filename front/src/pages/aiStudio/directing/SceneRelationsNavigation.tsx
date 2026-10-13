import { useEffect, useState } from 'react'
import { Alert, Button } from 'antd'
import { StudioDirectingService } from '../../../services/generated'
import { SceneWorkbenchOverview } from './SceneWorkbenchOverview'
import { SceneRelationDetails } from './SceneRelationDetails'
import type { SceneInspectionTarget } from './SceneRelationDetails'
import { directingError } from './common'
import type { SceneTakeLibraryRead, SceneVersionContent_Output } from '../../../services/generated'

export type SceneMediaNavigationTarget = { kind: 'take'; takeKind: SceneTakeLibraryRead['take_kind']; takeId: string } | { kind: 'clip'; clipId: string }
export type SceneNavigationTarget = SceneMediaNavigationTarget | { kind: 'shot'; shotId: string } | { kind: 'unit' | 'instruction'; shotId: string; unitId: string }

/** 关系树使用当前版本对象身份；展开仅改变导航展示，名称才定位业务对象。 */
export function SceneRelationsNavigation({ projectId, sequenceId, versionId, content, shotId, unitId, canvas, onNavigate }: {
  projectId: string; sequenceId: string; versionId: string
  content: SceneVersionContent_Output; shotId?: string; unitId?: string; canvas: string
  onNavigate: (target: SceneNavigationTarget) => void
}) {
  const [open, setOpen] = useState(() => window.innerWidth >= 760)
  const [expanded, setExpanded] = useState<Record<string, boolean>>({})
  const [overview, setOverview] = useState(false)
  const [inspection, setInspection] = useState<SceneInspectionTarget>()
  const [takes, setTakes] = useState<SceneTakeLibraryRead[]>()
  const [readError, setReadError] = useState('')
  const [loading, setLoading] = useState(false)
  const [attempt, setAttempt] = useState(0)
  useEffect(() => {
    if (!expanded.takes) return
    let active = true
    setLoading(true)
    void StudioDirectingService.directingSceneTakeLibrary({ projectId, sequenceId, versionId }).then(result => {
      if (!result.data) throw new Error('素材列表尚未核实')
      if (active) { setTakes(result.data); setReadError('') }
    }).catch(cause => { if (active) setReadError(directingError(cause)) })
      .finally(() => { if (active) setLoading(false) })
    return () => { active = false }
  }, [projectId, sequenceId, versionId, expanded.takes, attempt])
  const navigate = (target: SceneNavigationTarget) => {
    onNavigate(target)
    if (window.innerWidth < 760) setOpen(false)
  }
  const toggle = (key: string) => setExpanded(previous => ({ ...previous, [key]: !previous[key] }))
  return <><nav className="scene-relations-tree" aria-label="场次关系树">
    <Button aria-expanded={open} onClick={() => setOpen(value => !value)}>{open ? '收起关系树' : '展开关系树'}</Button>
    {open && <div className="scene-relations-tree-content"><h2>场次关系</h2>
      <Button onClick={() => setOverview(true)}>展开全图</Button>
      <ul aria-label="全场共享对象">
        <li><Button type="text" onClick={() => setInspection({ kind: 'basis' })}>查看版本原文依据</Button></li>
        <li><Button type="text" onClick={() => setInspection({ kind: 'shared' })}>查看全场共享设计</Button></li>
        <li><Button type="text" onClick={() => setInspection({ kind: 'location' })}>查看本场场所</Button></li>
        {content.design.participants.map(person => <li key={person.id}><Button type="text" aria-label={`查看参与对象：${person.name}`} onClick={() => setInspection({ kind: 'participant', id: person.id })}>{person.name} · 参与对象</Button></li>)}
      </ul>
      {!content.design.direction.shots.length && <p>当前版本尚无镜头</p>}
      <ul>{content.design.direction.shots.map((shot, index) => {
        const key = `shot:${shot.id}`
        const units = content.units.filter(unit => unit.coverage.some(item => item.shot_id === shot.id))
        return <li key={shot.id}>
          <div className="scene-relations-tree-row">
            <Button aria-label={`${expanded[key] ? '收起' : '展开'}镜头 ${index + 1}`} aria-expanded={!!expanded[key]} onClick={() => toggle(key)}>{expanded[key] ? '▾' : '▸'}</Button>
            <Button type="text" aria-label={`定位镜头 ${index + 1}：${shot.visible_result.text || '未填写'}`} aria-current={shotId === shot.id && canvas === 'director' ? 'location' : undefined}
              onClick={() => navigate({ kind: 'shot', shotId: shot.id })}>镜头 {index + 1} · {shot.visible_result.text || '未填写'}</Button>
          </div>
          {expanded[key] && <ul aria-label={`镜头 ${index + 1} 的关联单元`}>
            {!units.length && <li>尚无关联单元</li>}
            {units.map(unit => {
              const number = content.units.indexOf(unit) + 1
              const unitKey = `${key}:unit:${unit.id}`
              const selected = shotId === shot.id && unitId === unit.id
              return <li key={unit.id}>
                <div className="scene-relations-tree-row">
                  <Button aria-label={`${expanded[unitKey] ? '收起' : '展开'}单元 ${number}`} aria-expanded={!!expanded[unitKey]} onClick={() => toggle(unitKey)}>{expanded[unitKey] ? '▾' : '▸'}</Button>
                  <Button type="text" aria-label={`定位单元 ${number}：${unit.coverage.map(item => item.action_scope).join('；') || '动作待填写'}`} aria-current={selected && canvas === 'units' ? 'location' : undefined}
                    onClick={() => navigate({ kind: 'unit', shotId: shot.id, unitId: unit.id })}>单元 {number}：{unit.coverage.map(item => item.action_scope).join('；') || '动作待填写'}</Button>
                </div>
                {expanded[unitKey] && <ul><li><Button type="text" aria-label={`定位单元 ${number} 的指令`} aria-current={selected && canvas === 'instructions' ? 'location' : undefined}
                  onClick={() => navigate({ kind: 'instruction', shotId: shot.id, unitId: unit.id })}>当前指令{unit.instruction.trim() ? '' : ' · 未填写'}</Button></li>
                  {unit.references.map((reference, referenceIndex) => <li key={reference.id}><Button type="text" aria-label={`查看单元 ${number} 参考 ${referenceIndex + 1}`}
                    onClick={() => setInspection({ kind: 'reference', unitId: unit.id, id: reference.id })}>参考 {referenceIndex + 1} · {reference.asset_origin?.name || reference.media_kind}</Button></li>)}
                </ul>}
              </li>
            })}
          </ul>}
        </li>
      })}</ul>
      <Button aria-expanded={!!expanded.takes} onClick={() => toggle('takes')}>{expanded.takes ? '收起同场次素材' : '展开同场次素材'}</Button>
      {expanded.takes && <section aria-label="关系树素材列表">
        <Button loading={loading} onClick={() => setAttempt(value => value + 1)}>{readError ? '重试关系树素材' : '刷新关系树素材'}</Button>
        {loading && <p>正在核实同场次素材</p>}
        {readError && <Alert type="warning" message="关系树素材读取失败" description={readError} />}
        {!loading && !readError && takes?.length === 0 && <p>本场暂无已登记素材</p>}
        <ul>{takes?.map((take, index) => <li key={`${take.take_kind}:${take.take_id}`}>
          <Button type="text" disabled={loading || !!readError} aria-label={`定位源素材 ${index + 1}`}
            onClick={() => navigate({ kind: 'take', takeKind: take.take_kind, takeId: take.take_id })}>源素材 {index + 1} · {take.take_kind === 'scene_video' ? '场次版本' : '生产计划'}{take.available ? '' : ' · 文件不可用'}</Button>
        </li>)}</ul>
      </section>}
      <Button aria-expanded={!!expanded.clips} onClick={() => toggle('clips')}>{expanded.clips ? '收起时间线片段' : '展开时间线片段'}</Button>
      {expanded.clips && <ul aria-label="关系树时间线片段">
        {!content.timeline.items.length && <li>当前时间线为空</li>}
        {[...content.timeline.items].sort((a, b) => a.timeline_start_ms - b.timeline_start_ms).map((clip, index) => <li key={clip.id}>
          <Button type="text" aria-label={`定位片段 ${index + 1}`} onClick={() => navigate({ kind: 'clip', clipId: clip.id })}>片段 {index + 1} · {'media_range' in clip ? '真实媒体' : '待拍占位'} · {clip.timeline_start_ms} 毫秒</Button>
        </li>)}
      </ul>}
    </div>}
  </nav>
    {overview && <SceneWorkbenchOverview projectId={projectId} sequenceId={sequenceId} versionId={versionId} content={content} unitId={unitId} shotId={shotId} onNavigate={navigate} onClose={() => setOverview(false)} />}
    {inspection && <SceneRelationDetails key={JSON.stringify(inspection)} projectId={projectId} content={content} target={inspection} onClose={() => setInspection(undefined)} />}
  </>
}
