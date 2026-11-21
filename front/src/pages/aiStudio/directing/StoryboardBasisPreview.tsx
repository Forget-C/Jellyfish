import { useUiText } from '../../../uiText'
import { Alert, Button, Checkbox, Typography } from 'antd'
import type { StoryboardBasis } from '../../../services/generated'

/** 显示采用的对象身份；当前参考状态仅供核对，历史依据不推断状态。 */
export function StoryboardBasisPreview({ basis, useSaved, onUseSaved, onRefresh, onOpenSource, onOpenObjects,
  compact = false, readOnly = false, sourceLabel = '本次采用的场次摘录', emptyText }: {
  compact?: boolean; readOnly?: boolean
  basis: StoryboardBasis; useSaved: boolean; onUseSaved: (value: boolean) => void
  onRefresh?: () => void; onOpenSource: () => void; onOpenObjects: () => void; sourceLabel?: string; emptyText?: string
}) {
  const uiText = useUiText()
  return <div className="management-storyboard-basis">
    {basis.source_changed && <Alert showIcon type="warning" message={uiText("章节正文已变化，本次仍采用下方已确认摘录。")}
      action={!readOnly && <Button size="small" onClick={onOpenSource}>{uiText("核对场次范围")}</Button>} />}
    <details open>
      <summary>{uiText(sourceLabel)}</summary>
      {compact ? <Typography.Paragraph className="management-excerpt" ellipsis={{ rows: 6, expandable: true, symbol: uiText("展开全文") }}>{basis.source_text}</Typography.Paragraph> : <p className="management-excerpt">{basis.source_text}</p>}
    </details>
    {!!basis.shooting_notes?.length && <details open><summary>{uiText("本次采用的拍摄解释")}</summary>
      <ul>{basis.shooting_notes.map((note, index) => <li key={note.id || index}>{note.choice === 'delegate' ? uiText("交由生成设计：") : ''}{note.text}</li>)}</ul>
      {!readOnly && <Button size="small" onClick={onOpenSource}>{uiText("编辑拍摄解释")}</Button>}
    </details>}
    {basis.preparation_stale ? <Alert showIcon type="warning" message={uiText("已保存对象与当前场次摘录不符，请先刷新对象准备。")}
      action={!readOnly && <Button size="small" onClick={onOpenObjects}>{uiText("前往对象与参考")}</Button>} />
      : <>
        {basis.object_task_active && <Alert showIcon type="info" message={onRefresh ? uiText("对象提取进行中，可等待后重新读取依据。") : uiText("对象提取进行中，请关闭后重新打开核对。")}
          action={!readOnly && onRefresh && <Button size="small" onClick={onRefresh}>{uiText("重新读取依据")}</Button>} />}
        {basis.object_task_active && basis.preparation_revision > 0 &&
          <Checkbox disabled={readOnly} checked={useSaved} onChange={event => onUseSaved(event.target.checked)}>{uiText("使用已保存对象继续")}</Checkbox>}
        {basis.objects.length ? <details>
          <summary>{uiText("本次采用的对象（{{count}}）", { count: basis.objects.length })}</summary>
          <ul>{basis.objects.map(object => <li key={object.id}>
            {object.name}{basis.objects.some(other => other.id !== object.id && other.name === object.name) && `（${object.excerpt}）`}
            {' · '}{uiText(({ character: '角色', scene: '场景', prop: '道具' })[object.kind])}
            {' · '}{object.asset_name || (object.reference_state ? '—' : object.reference_unavailable ? uiText("已选用资源不可用") : uiText("未选用资源"))}
            {object.reference_state && <> · {uiText(({ ready: '主图可用', unassociated: '未选用资源', missing: '缺少可用主图', unavailable: '已选用资源不可用' })[object.reference_state])}</>}
          </li>)}</ul>
          {!readOnly && <Button size="small" onClick={onOpenObjects}>{uiText("查看对象参考")}</Button>}
        </details> : <p>{emptyText ?? (basis.preparation_revision ? uiText("已保存准备没有对象，可以继续生成。") : uiText("尚未准备对象，可以直接生成分镜。"))}</p>}
      </>}
  </div>
}
