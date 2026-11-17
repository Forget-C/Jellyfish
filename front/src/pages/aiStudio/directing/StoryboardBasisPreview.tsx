import { Alert, Button, Checkbox, Typography } from 'antd'
import type { StoryboardBasis } from '../../../services/generated'

/** 显示采用的对象身份；当前参考状态仅供核对，历史依据不推断状态。 */
export function StoryboardBasisPreview({ basis, useSaved, onUseSaved, onRefresh, onOpenSource, onOpenObjects,
  compact = false, readOnly = false, sourceLabel = '本次采用的场次摘录', emptyText }: {
  compact?: boolean; readOnly?: boolean
  basis: StoryboardBasis; useSaved: boolean; onUseSaved: (value: boolean) => void
  onRefresh?: () => void; onOpenSource: () => void; onOpenObjects: () => void; sourceLabel?: string; emptyText?: string
}) {
  return <div className="management-storyboard-basis">
    {basis.source_changed && <Alert showIcon type="warning" message="章节正文已变化，本次仍采用下方已确认摘录。"
      action={!readOnly && <Button size="small" onClick={onOpenSource}>核对场次范围</Button>} />}
    <details open>
      <summary>{sourceLabel}</summary>
      {compact ? <Typography.Paragraph className="management-excerpt" ellipsis={{ rows: 6, expandable: true, symbol: '展开全文' }}>{basis.source_text}</Typography.Paragraph> : <p className="management-excerpt">{basis.source_text}</p>}
    </details>
    {!!basis.shooting_notes?.length && <details open><summary>本次采用的场次拍摄说明</summary>
      <ul>{basis.shooting_notes.map((note, index) => <li key={note.id || index}>{note.choice === 'delegate' ? '交由生成设计：' : ''}{note.text}</li>)}</ul>
      <p>作为场次参考说明使用。</p>{!readOnly && <Button size="small" onClick={onOpenSource}>编辑场次拍摄说明</Button>}
    </details>}
    {basis.preparation_stale ? <Alert showIcon type="warning" message="已保存对象与当前场次摘录不符，请先刷新对象准备。"
      action={!readOnly && <Button size="small" onClick={onOpenObjects}>前往对象与参考</Button>} />
      : <>
        {basis.object_task_active && <Alert showIcon type="info" message={onRefresh ? '对象提取进行中，可等待后重新读取依据。' : '对象提取进行中，请关闭后重新打开核对。'}
          action={!readOnly && onRefresh && <Button size="small" onClick={onRefresh}>重新读取依据</Button>} />}
        {basis.object_task_active && basis.preparation_revision > 0 &&
          <Checkbox disabled={readOnly} checked={useSaved} onChange={event => onUseSaved(event.target.checked)}>使用已保存对象继续</Checkbox>}
        {basis.objects.length ? <details>
          <summary>本次采用的对象（{basis.objects.length}）</summary>
          <ul>{basis.objects.map(object => <li key={object.id}>
            {object.name}{basis.objects.some(other => other.id !== object.id && other.name === object.name) && `（${object.excerpt}）`}
            {' · '}{({ character: '角色', scene: '场景', prop: '道具' })[object.kind]}
            {' · '}{object.asset_name || (object.reference_state ? '—' : object.reference_unavailable ? '已选用资源不可用' : '未选用资源')}
            {object.reference_state && <> · {({ ready: '主图可用', unassociated: '未选用资源', missing: '缺少可用主图', unavailable: '已选用资源不可用' })[object.reference_state]}</>}
          </li>)}</ul>
          {!readOnly && <Button size="small" onClick={onOpenObjects}>查看对象参考</Button>}
        </details> : <p>{emptyText ?? (basis.preparation_revision ? '已保存准备没有对象，可以继续生成。' : '尚未准备对象，可以直接生成分镜。')}</p>}
      </>}
  </div>
}
