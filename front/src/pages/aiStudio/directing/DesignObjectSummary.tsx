import type { SceneDesign_Input, SceneRelationshipGraph } from '../../../services/generated'
import type { DesignObject } from './designWorkspace'
import { departmentNames } from './designWorkspace'
import { designCard } from './designCard'
import { CanvasTextPreview } from './CanvasTextPreview'
import { WorkbenchButton } from './ui/WorkbenchButton'
import { designAt } from './designValue'
import { noteText } from './designValue'
import { designLabels } from './designLabels'
import { ExclamationCircleOutlined, EditOutlined } from '@ant-design/icons'

const compactKind = (key: string) => key === 'overview' || key === 'space' || objectEvidence(key) || /^(performance|staging|sound|prompt)$/.test(key) || /^(shot|camera|criterion|performance|blocking|situation|activity|continuity|dialogue):/.test(key)
const objectEvidence = (key: string) => /^(participant|beat|event|anchor|missing):/.test(key)

function CompactDesignSummary({ value, object, card }: { value: SceneDesign_Input; object: DesignObject; card: ReturnType<typeof designCard> }) {
  const row = designAt(value, object.path) as any
  const note = (value: any) => noteText(value) || (value?.state === 'unknown' ? '待确定' : value?.state === 'none' ? '明确没有' : value?.state === 'not_applicable' ? '不适用' : '未填写')
  const person = (id?: string) => !id ? '未填写' : value.participants.find(item => item.id === id)?.name || `人物引用缺失 · ${id}`
  const beat = (id?: string) => { if (!id) return '未填写'; const index = value.direction.beats.findIndex(item => item.id === id); return index < 0 ? `节拍引用缺失 · ${id}` : `节拍 ${String(index + 1).padStart(2, '0')}` }
  let fields: { label: string; text: string }[] = []
  if (object.kind === 'missing') fields = [{ label: '缺失对象标识', text: object.key }, { label: '关联状态', text: '关联对象已不存在，请核对引用' }]
  else if (object.key.startsWith('shot:')) {
    const participants = row.participant_ids == null ? '范围待核对' : row.participant_ids.length === 0 ? '明确无参与对象' : (() => {
      const names = row.participant_ids.map((id: string) => value.participants.find(person => person.id === id)?.name || `缺失引用 · ${id}`)
      return `${names.slice(0, 2).join('、')}${names.length > 2 ? ` ＋${names.length - 2}` : ''}`
    })()
    fields = [{ label: '可见结果', text: note(row.visible_result) }, { label: '叙事作用', text: note(row.narrative_function) },
      { label: '预计时长', text: row.estimated_duration_ms ? `${row.estimated_duration_ms / 1000} 秒` : '未填写' }, { label: '参与对象', text: participants }]
  } else if (object.key.startsWith('camera:')) {
    const index = value.direction.shots.findIndex(shot => shot.id === row.shot_id)
    fields = [{ label: '所属镜头', text: !row.shot_id ? '未填写' : index < 0 ? '镜头引用缺失' : `镜头 ${String(index + 1).padStart(2, '0')}` },
      { label: '构图重心', text: note(row.composition) }, { label: '运动路径', text: note(row.movement_path) }, { label: '结束画面', text: note(row.end_frame) }]
  } else if (object.key.startsWith('criterion:')) fields = [{ label: '验收要求', text: note(row.requirement) }]
  else if (object.key.startsWith('performance:')) fields = [{ label: '人物与节拍', text: `${person(row.participant_id)} · ${beat(row.beat_id)}` },
    { label: '可见身体动作', text: note(row.physical_action) }, { label: '行动目标', text: note(row.objective) }]
  else if (object.key.startsWith('blocking:')) fields = [{ label: '人物／物件', text: person(row.participant_id) },
    { label: '位置与朝向', text: `${note(row.position)} · ${note(row.orientation)}` }, { label: '行动路径', text: note(row.path) }]
  else if (object.key.startsWith('situation:')) fields = [{ label: '人物', text: person(row.participant_id) },
    { label: '当前处境', text: note(row.situation) }, { label: '人物关系', text: note(row.relationship) }]
  else if (object.key.startsWith('activity:')) fields = [{ label: '人物／物件', text: person(row.participant_id) },
    { label: '持续任务', text: note(row.ongoing_task) }, { label: '景深层次', text: note(row.depth) }]
  else if (object.key.startsWith('continuity:')) fields = [{ label: '领域与对象', text: `${({ hands_props: '手部与道具', space: '空间', appearance: '造型', environment: '环境', camera: '摄影', dialogue_sound: '对白与声音' } as Record<string, string>)[row.domain] || row.domain || '未填写'} · ${row.participant_id ? person(row.participant_id) : row.event_id ? `事件 ${value.events.findIndex(item => item.id === row.event_id) + 1 || '引用缺失'}` : '未指定对象'}` },
    { label: '前态 → 后态', text: `${note(row.before)} → ${note(row.after)}` }, { label: '后续约束', text: note(row.following_constraint) }]
  else if (object.key.startsWith('dialogue:')) fields = [{ label: '说话对象', text: person(row.participant_id) }, { label: '对白内容', text: note(row.content) }]
  else if (object.key.startsWith('participant:')) fields = [{ label: '名称', text: row.name || '未填写' },
    { label: '资产绑定', text: row.character_id ? `关联角色 · ${row.character_id}` : row.prop_id ? `关联道具 · ${row.prop_id}` : '未绑定角色或道具' }]
  else if (object.key.startsWith('beat:')) fields = [{ label: '行动目标', text: note(row.objective) }, { label: '预期变化', text: note(row.expected_change) }]
  else if (object.key.startsWith('event:')) fields = [{ label: '事件说明', text: note(row.description) }]
  else if (object.key.startsWith('anchor:')) fields = [{ label: '锚点说明', text: note(row.description) }]
  else if (object.key === 'overview') fields = [{ label: '观察视点', text: note(row.viewpoint) },
    { label: '本场信息变化', text: note(row.information_change) }, { label: '关键转折', text: note(row.turning_point) }]
  else if (object.key === 'space') fields = [{ label: '空间依据', text: note(row.spatial_basis) }, { label: '可拍摄区域', text: note(row.shootable_area) }, { label: '轴线与尺度', text: `${note(row.axis)} · ${note(row.scale)}` }]
  else if (object.key === 'performance') fields = [{ label: '适用说明', text: note(row.applicability) }]
  else if (object.key === 'staging') fields = [{ label: '环境活动', text: note(row.environment) }, { label: '留白理由', text: note(row.intentional_absence) }]
  else if (object.key === 'sound') fields = [{ label: '声音执行方式', text: ({ postproduction: '待后期', generated: '同期生成', unknown: '待确定' } as Record<string, string>)[row.execution] || '待确定' },
    { label: '声源', text: note(row.sources) }, { label: '环境与动作声', text: note(row.ambience_actions) }]
  else fields = [{ label: '编译优先级', text: note(row.priorities) }, { label: '禁止项', text: note(row.prohibitions) }]
  return <div className="design-compact-summary">
    <div className="design-compact-fields">{fields.map(field => <p key={field.label} title={`${field.label}：${field.text}`}><span>{field.label}</span><strong>{field.text}</strong></p>)}</div>
    <div className="design-compact-status"><span title={card.scope}>{card.scope}</span>
      {!!card.issues.length && <span title={`待处理 ${card.issues.length} 项`} aria-label={`待处理 ${card.issues.length} 项`} tabIndex={0}><ExclamationCircleOutlined /> {card.issues.length}</span>}
      {card.dirty && <span title="有未保存修改" aria-label="有未保存修改" tabIndex={0}><EditOutlined /></span>}
    </div>
  </div>
}

/** 卡片与编辑区共用真实范围和问题，正文始终来自当前已应用的设计。 */
export function DesignObjectSummary({ value, saved, object, relationshipGraph, onSelectShot, showText = true, editing = false, compact = false }: {
  value: SceneDesign_Input; saved?: SceneDesign_Input; object: DesignObject; relationshipGraph?: SceneRelationshipGraph; onSelectShot?: (id: string) => void; showText?: boolean; editing?: boolean; compact?: boolean
}) {
  const card = designCard(value, object, saved, relationshipGraph)
  const scopeIssues = relationshipGraph?.issues?.filter(row => row.owner === object.key) || []
  card.issues = [...card.issues, ...scopeIssues.map(row => `${designLabels[row.field] || row.field}：${row.reason}`)]
  if (compact && (compactKind(object.key) || object.kind === 'missing')) return <CompactDesignSummary value={value} object={object} card={card} />
  return <div className="design-object-summary">
    <p>{departmentNames[object.kind] || '关联依据'} · {card.scope}{card.dirty && <strong> · 有未保存修改</strong>}</p>
    {card.subject && <p>{card.subject}</p>}
    {!!card.issues.length && <details className="design-object-issues"><summary>待处理 {card.issues.length} 项</summary><ul>{card.issues.map(issue => <li key={issue}>{issue}</li>)}</ul></details>}
    {showText && <CanvasTextPreview text={card.text || '尚无设计正文'} label="设计正文" lines={4} />}
    {!!card.references.length && <details><summary>适用对象与引用</summary><ul>{card.references.map(reference => <li key={reference}>{reference}</li>)}</ul></details>}
    {!!card.shots.length && !object.key.startsWith('shot:') && <details open={card.shots.length <= 3}><summary>关联镜头与依据 · {card.shots.length}</summary>{card.shots.map(shot => <div key={shot.id}>
      <WorkbenchButton variant="quiet" disabled={!onSelectShot || !value.direction.shots.some(row => row.id === shot.id)} onClick={() => onSelectShot?.(shot.id)}>{shot.label}</WorkbenchButton><span>{shot.via || '镜头自身'}</span>
    </div>)}</details>}
    {editing && <p>{card.shared ? '修改将作用于全场。' : card.shots.length ? `修改将影响${card.shots.map(shot => shot.label).join('、')}。` : '此对象没有明确的镜头关联，请按原有适用范围编辑。'}关闭后保留当前输入，通过场次统一保存。</p>}
  </div>
}
