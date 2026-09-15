import { Card, Space, Tag, Typography } from 'antd'
import type { Note_Input, SceneDesign_Input } from '../../../services/generated'

const states: Record<string, string> = { unset: '未填写', unknown: '待确定', proposal: '设计建议', fact: '已知事实', none: '明确没有', not_applicable: '不适用' }

/** 摘要直接读取设计字段，保留判断状态，不将空白或建议包装成事实。 */
export function DesignNote({ note }: { note?: Note_Input }) {
  return <span><Tag>{states[note?.state || 'unset'] || '未填写'}</Tag><span>{note?.text || note?.reason || ''}</span></span>
}

/** 产出概览与完整工作单共用同一份设计，没有独立可编辑副本。 */
export function DesignSummary({ value }: { value: SceneDesign_Input }) {
  return <Space role="region" aria-label="拍摄方案概览" direction="vertical" style={{ width: '100%' }}>
    <Card title="这场戏，观众需要看到什么？" size="small">
      <p>本场信息变化：<DesignNote note={value.direction.information_change} /></p>
      <p>人物关系变化：<DesignNote note={value.direction.relationship_change} /></p>
      <p>关键转折：<DesignNote note={value.direction.turning_point} /></p>
      {value.direction.beats.map((beat, index) => <p key={beat.id}>行动 {index + 1}：<DesignNote note={beat.objective} /> · 必须看到：<DesignNote note={beat.must_show} /></p>)}
    </Card>
    <Typography.Text strong>计划镜头 · {value.direction.shots.length} 项</Typography.Text>
    <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(min(100%, 240px), 1fr))', gap: 12, width: '100%' }}>
      {value.direction.shots.map((shot, index) => <Card size="small" key={shot.id} title={`镜头 ${index + 1} · 文字计划`}>
        <p><DesignNote note={shot.visible_result} /></p>
        <p>叙事作用：<DesignNote note={shot.narrative_function} /></p>
        <Typography.Text type="secondary">{(shot.estimated_duration_ms === null || shot.estimated_duration_ms === undefined) ? '预计时长未填写' : `预计 ${shot.estimated_duration_ms / 1000} 秒`} · 尚不代表实际拍到</Typography.Text>
        <details><summary>镜头身份与依据</summary>{shot.id} · 节拍：{shot.beat_ids.join('、') || '未填写'} · 事件：{shot.event_ids.join('、') || '未填写'}</details>
      </Card>)}
    </div>
    <Card size="small" title="关键问题与声音安排">
      {value.direction.open_questions.length ? value.direction.open_questions.map((note, index) => <p key={index}><DesignNote note={note} /></p>) : <p>尚未列出待确定问题，不代表已完成检查。</p>}
      <Typography.Text>声音：{value.sound.execution === 'postproduction' ? '待后期制作' : value.sound.execution === 'generated' ? '计划同期生成' : '执行方式待确定'}</Typography.Text>
    </Card>
  </Space>
}
