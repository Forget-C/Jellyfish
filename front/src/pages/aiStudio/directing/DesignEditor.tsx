import { useState } from 'react'
import { Button, Card, Collapse, Input, InputNumber, Select, Space, Typography } from 'antd'
import type { SceneDesign_Input, Note_Input } from '../../../services/generated'
import { humanNote } from './common'
import { emptyDesign } from './designTemplate'

const labels: Record<string, string> = {
  participants: '人物与物件', events: '触发事件', criteria: '验收要求', direction: '总导演', performance: '表演指导', staging: '镜内执行', cinematography: '摄影指导', continuity: '场记与连续性', sound: '对白与声音', prompt: '提示词指导',
  id: '标识', name: '名称', character_id: '关联角色', prop_id: '关联道具', description: '说明', requirement: '验收要求', viewpoint: '观察视点', information_change: '本场信息变化', relationship_change: '人物关系变化', turning_point: '关键转折', immutable_facts: '不可改事实', location_asset_id: '场所资产', spatial_basis: '空间依据', shootable_area: '可拍区域', axis: '轴线', scale: '空间尺度', open_questions: '待确定问题', control_level: '创作控制',
  beats: '节拍', anchors: '空间锚点', blocking_states: '调度状态', shots: '镜头覆盖', event_ids: '关联事件', objective: '行动目标', obstacle: '阻碍', expected_change: '预期变化', must_show: '必须让观众看到', participant_id: '人物/物件', anchor_ids: '位置锚点', event_id: '变化事件', position: '位置', orientation: '朝向', initiative: '主动权', path: '行动路径', transition_reason: '切换原因',
  beat_ids: '覆盖节拍', blocking_state_ids: '调度依据', criterion_ids: '验收依据', narrative_function: '叙事作用', visible_result: '可见结果', estimated_duration_ms: '预计时长（毫秒）', situations: '角色情境', situation: '当前处境', relationship: '人物关系', beat_id: '所属节拍', received_event_ids: '接收到的事件', subtext: '潜台词', attention: '注意对象', internal_adjustment: '内部调整', physical_action: '可见身体动作', dialogue_ids: '对白依据', delivery: '表达方式', reaction_order: '反应先后', exit_state: '离开节拍时的状态', avoid: '避免的表现', gaze: '目光', breath: '呼吸', weight: '身体重心', hands: '手部', voice: '声音', applicability: '适用说明',
  activities: '镜内活动', anchor_id: '区域锚点', trigger_event_id: '触发事件', depth: '景深层次', ongoing_task: '持续任务', reaction_delay: '反应延迟依据', delay_ms: '明确延迟（毫秒）', intensity: '活动强度', entrances_exits: '入出画', narrative_support: '对主戏的作用', end_state: '结束状态', environment: '环境活动', intentional_absence: '留白理由',
  shot_id: '所属镜头', composition: '构图重心', depth_layers: '空间层次', height_angle: '高度与角度', lens_effect: '焦段或透视效果', depth_focus: '景深与焦点', support: '支撑方式', movement_start: '运动起点', movement_trigger: '运动触发', movement_path: '运动路径', movement_speed: '运动速度', end_frame: '结束画面', light_sources: '光源', light_regions: '明暗区域', exposure_color: '曝光与色温', optical_effects: '光学效果', motion_texture: '运动质感', technical_parameters: '技术意图', adjacent_requirements: '相邻镜头衔接', prohibitions: '禁止项',
  domain: '连续性领域', before: '前态', change: '变化', after: '后态', following_constraint: '后续约束', dialogues: '对白', version: '对白版本', content: '内容', sources: '声源', ambience_actions: '环境与动作声', music_constraints: '音乐约束', execution: '声音执行方式', priorities: '编译优先级', binding_requirements: '参考绑定要求', sound_strategy: '声音策略',
}
const states = [{ value: 'unset', label: '未填写' }, { value: 'proposal', label: '设计建议' }, { value: 'fact', label: '已知事实' }, { value: 'unknown', label: '待确定' }, { value: 'not_applicable', label: '不适用' }, { value: 'none', label: '明确没有' }]
type Value = unknown

/** 递归展示有语义的工作单字段，编辑同一份契约，避免额外 Markdown 真值。 */
export function DesignEditor({ value, onChange, disabled = false }: { value: SceneDesign_Input; onChange: (value: SceneDesign_Input) => void; disabled?: boolean }) {
  const [query, setQuery] = useState('')
  const blank = emptyDesign()
  /** 按中文字段名、稳定身份或内容定位所属工作单，避免在长表单中逐项翻找。 */
  const matches = (key: string, child: unknown): boolean => {
    const search = query.trim().toLowerCase()
    if (!search || `${labels[key] || key} ${typeof child === 'string' ? child : ''}`.toLowerCase().includes(search)) return true
    return !!child && typeof child === 'object' && Object.entries(child).some(([name, value]) => matches(name, value))
  }
  /** 将局部字段变化写回不可变副本，服务端最终验证共享身份。 */
  const change = (path: Array<string | number>, next: Value) => {
    const copy = structuredClone(value)
    let node = copy as unknown as Record<string, unknown>
    path.slice(0, -1).forEach(key => { node = node[key] as Record<string, unknown> })
    node[path[path.length - 1]] = next
    onChange(copy)
  }
  /** 根据关联字段列出当前设计中的合法候选身份。 */
  const options = (key: string) => {
    if (key.includes('participant')) return value.participants.map(row => ({ value: row.id, label: row.name }))
    const rows = key.includes('beat') ? value.direction.beats : key.includes('event') ? value.events : key.includes('anchor') ? value.direction.anchors : key.includes('blocking') ? value.direction.blocking_states : key.includes('criterion') ? value.criteria : key.includes('dialogue') ? value.sound.dialogues : key === 'shot_id' ? value.direction.shots : []
    return rows.map(row => ({ value: row.id, label: row.id }))
  }
  /** 渲染未知/事实/不适用等状态，空内容不能通过输入控件变成假事实。 */
  const render = (current: unknown, path: Array<string | number>, template: unknown): React.ReactNode => {
    const key = String(path[path.length - 1])
    const label = labels[key] || key
    const templateFields = template && typeof template === 'object' ? template as Record<string, unknown> : {}
    if (current && typeof current === 'object' && !Array.isArray(current) && ('state' in current)) {
      const note = current as Note_Input
      return <Space direction="vertical" size={4} style={{ width: '100%' }}>
        <Space><Typography.Text>{label}</Typography.Text><Select size="small" value={note.state || 'unset'} options={states} disabled={disabled} style={{ width: 125 }} onChange={state => change(path, ['none', 'not_applicable'].includes(state) ? { state, reason: note.reason || '' } : ['unset', 'unknown'].includes(state) ? { state } : { ...humanNote(note.text || ''), state })} /></Space>
        <Input.TextArea disabled={disabled} value={note.text || note.reason || ''} autoSize={{ minRows: 1, maxRows: 5 }} placeholder="填写可观察、可拍摄的内容" onChange={event => change(path, ['none', 'not_applicable'].includes(note.state || '') ? { ...note, reason: event.target.value } : { ...humanNote(event.target.value), state: note.state === 'fact' ? 'fact' : 'proposal' })} />
        {!!note.sources?.length && <Typography.Text type="secondary">来源：{note.sources.map(source => `${source.kind} · ${source.reference} · ${source.version}`).join('；')}</Typography.Text>}
      </Space>
    }
    if (Array.isArray(current)) {
      if (key.endsWith('_ids')) return <Select mode="multiple" aria-label={label} disabled={disabled} value={current} options={options(key)} onChange={next => change(path, next)} style={{ width: '100%' }} />
      return <Space direction="vertical" style={{ width: '100%' }}>
        {current.map((row, index) => <Card key={index} size="small" title={`${label} ${index + 1}`} extra={!disabled && <Button size="small" danger onClick={() => change(path, current.filter((_, i) => i !== index))}>移除</Button>}>{render(row, [...path, index], (Array.isArray(template) ? template[0] : undefined))}</Card>)}
        {!disabled && <Button onClick={() => {
          const sample = (Array.isArray(template) ? template[0] : undefined) || current[0] || { state: 'unset' }
          const next = structuredClone(sample)
          if (next && typeof next === 'object' && 'id' in next) next.id = 'item-' + crypto.randomUUID().slice(0, 8)
          change(path, [...current, next])
        }}>添加{label}</Button>}
      </Space>
    }
    if (current && typeof current === 'object') return <Space direction="vertical" size="middle" style={{ width: '100%' }}>
      {Object.entries({ ...templateFields, ...current }).filter(([name]) => !['sources', 'style_revision_id'].includes(name) || (path[0] === 'sound' && name === 'sources')).map(([name, child]) => <div key={name}>
        {!(child && typeof child === 'object' && 'state' in child) && <Typography.Text type="secondary">{labels[name] || name}</Typography.Text>}
        {render(child, [...path, name], templateFields[name])}
      </div>)}
    </Space>
    if (['character_id', 'prop_id', 'location_asset_id'].includes(key)) return <Typography.Text>{typeof current === 'string' && current ? current : '未关联资产'}</Typography.Text>
    if (key.endsWith('_id') && options(key).length) return <Select allowClear disabled={disabled} value={current} options={options(key)} onChange={next => change(path, next ?? null)} style={{ width: '100%' }} />
    if (key === 'domain' || key === 'execution') return <Select disabled={disabled} value={current} style={{ width: '100%' }} options={(key === 'domain' ? ['space', 'appearance', 'hands_props', 'environment', 'camera', 'dialogue_sound'] : ['postproduction', 'generated', 'unknown']).map(item => ({ value: item, label: ({ space: '空间', appearance: '造型', hands_props: '手部与道具', environment: '环境', camera: '摄影', dialogue_sound: '对白与声音', postproduction: '待后期', generated: '同期生成', unknown: '待确定' } as Record<string, string>)[item] }))} onChange={next => change(path, next)} />
    if (typeof current === 'number' || ['delay_ms', 'estimated_duration_ms'].includes(key)) return <InputNumber aria-label={label} disabled={disabled} min={key === 'estimated_duration_ms' ? 1 : 0} precision={0} value={typeof current === 'number' ? current : null} onChange={next => change(path, next)} />
    return <Input disabled={disabled || key === 'id'} value={typeof current === 'string' ? current : ''} onChange={event => change(path, event.target.value || null)} />
  }
  return <><Input.Search aria-label="定位工作单问题" placeholder="搜索部门、字段、镜头或内容" value={query} onChange={event => setQuery(event.target.value)} allowClear /><Typography.Paragraph type="secondary">设计来源：{value.sources.map(source => `${source.kind} · ${source.reference} · ${source.version}`).join('；')}</Typography.Paragraph><Collapse items={Object.entries(value).filter(([key, child]) => !['sources', 'style_revision_id'].includes(key) && matches(key, child)).map(([key, child]) => ({ key, label: labels[key] || key, children: render(child, [key], (blank as unknown as Record<string, unknown>)[key]) }))} defaultActiveKey={['direction']} /></>
}
