import type { MediaTaskReceipt } from '../../../../services/generated'
import { useUiText } from '../../../../uiText'

/** The model and input evidence frozen when the task was submitted. */
export function MediaTaskDetails({ receipt, label }: { receipt: MediaTaskReceipt; label?: string }) {
  const uiText = useUiText()
  return <details className="experiment-media-details">
    <summary>{label ?? uiText('生成详情')}</summary>
    <div>{uiText('模型')} · {receipt.model_name ?? receipt.model_id ?? '—'}</div>
    {receipt.references?.map(ref => <div key={ref.role + ':' + ref.ordinal}>{ref.role} · {ref.file_id}</div>)}
    <div>{uiText('任务身份')} · {receipt.task_id}</div>
    {receipt.parameters && <pre>{JSON.stringify(receipt.parameters, null, 2)}</pre>}
  </details>
}
