import type { MediaTaskReceipt } from '../../../../services/generated'
import { useUiText } from '../../../../uiText'

/** The model and input evidence frozen when the task was submitted. */
export function MediaTaskDetails({ receipt, elapsed }: { receipt: MediaTaskReceipt; elapsed?: string }) {
  const uiText = useUiText()
  return <div className="experiment-media-details">
    {elapsed && <div>{elapsed}</div>}
    <div>{uiText('模型')} · {receipt.model_name ?? receipt.model_id ?? '—'}</div>
    {receipt.references?.map(ref => <div key={ref.role + ':' + ref.ordinal}>{ref.role} · {ref.file_id}</div>)}
    <div>{uiText('任务身份')} · {receipt.task_id}</div>
    {receipt.parameters && <pre>{JSON.stringify(receipt.parameters, null, 2)}</pre>}
  </div>
}
