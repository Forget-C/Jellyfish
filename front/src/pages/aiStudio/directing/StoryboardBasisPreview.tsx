import { Alert, Button, Checkbox } from 'antd'
import type { StoryboardBasis } from '../../../services/generated'

/** 显示本次会固定的摘录及可用参考，和当前对象任务状态分别表达。 */
export function StoryboardBasisPreview({ basis, useSaved, onUseSaved, onRefresh, onOpenSource, onOpenObjects }: {
  basis: StoryboardBasis; useSaved: boolean; onUseSaved: (value: boolean) => void
  onRefresh: () => void; onOpenSource: () => void; onOpenObjects: () => void
}) {
  return <div className="management-storyboard-basis">
    {basis.source_changed && <Alert showIcon type="warning" message="章节正文已变化，本次仍采用下方已确认摘录。"
      action={<Button size="small" onClick={onOpenSource}>核对场次范围</Button>} />}
    <details open>
      <summary>本次采用的场次摘录</summary>
      <p className="management-excerpt">{basis.source_text}</p>
    </details>
    {basis.preparation_stale ? <Alert showIcon type="warning" message="已保存对象与当前场次摘录不符，请先刷新对象准备。"
      action={<Button size="small" onClick={onOpenObjects}>前往对象与参考</Button>} />
      : <>
        {basis.object_task_active && <Alert showIcon type="info" message="对象提取进行中，可等待后重新读取依据。"
          action={<Button size="small" onClick={onRefresh}>重新读取依据</Button>} />}
        {basis.object_task_active && basis.preparation_revision > 0 &&
          <Checkbox checked={useSaved} onChange={event => onUseSaved(event.target.checked)}>使用已保存对象继续</Checkbox>}
        {basis.objects.length ? <details>
          <summary>本次采用的对象与参考（{basis.objects.length}）</summary>
          <ul>{basis.objects.map(object => <li key={object.id}>
            {object.name} · {object.asset_name || '未关联资产'} · {object.image_file_id ? '已选参考图' : '无参考图'}
          </li>)}</ul>
        </details> : <p>{basis.preparation_revision ? '已保存准备没有对象，可以继续生成。' : '尚未准备对象，可以直接生成分镜。'}</p>}
      </>}
  </div>
}
