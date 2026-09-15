import { Tag } from 'antd'
import type { Note_Input } from '../../../services/generated'

const states: Record<string, string> = { unset: '未填写', unknown: '待确定', proposal: '设计建议', fact: '已知事实', none: '明确没有', not_applicable: '不适用' }

/** 摘要直接读取设计字段，保留判断状态，不将空白或建议包装成事实。 */
export function DesignNote({ note }: { note?: Note_Input }) {
  return <span><Tag>{states[note?.state || 'unset'] || '未填写'}</Tag><span>{note?.text || note?.reason || ''}</span></span>
}

