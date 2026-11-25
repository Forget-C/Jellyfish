import type { MediaTaskReceipt } from '../../../../services/generated'
import { useUiText } from '../../../../uiText'

/** The model and input evidence frozen when the task was submitted. */
export function MediaTaskDetails({ receipt }: { receipt: MediaTaskReceipt }) {
  const uiText = useUiText()
  return <details>
    <summary>{uiText('模型')} · {receipt.model_name ?? receipt.model_id}</summary>
    <div>{uiText('任务身份')} · {receipt.task_id}</div>
    <pre>{JSON.stringify(receipt.parameters, null, 2)}</pre>
    {receipt.references?.map(ref => <div key={ref.role + ':' + ref.ordinal}>{ref.role} · {ref.file_id}</div>)}
  </details>
}
