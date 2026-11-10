import { useEffect, useRef, useState } from 'react'
import { Alert, Empty, Space } from 'antd'
import { WorkbenchButton as Button } from '../directing/ui/WorkbenchButton'
import type { CanvasNodeRead, CanvasRunRead } from '../../../services/generated'
import { WorkbenchDetails } from '../directing/ui/WorkbenchDetails'
import { CanvasTextPreview } from '../directing/CanvasTextPreview'
import type { VideoFrameSource } from './SaveVideoFrameDialog'
import { MediaPreview } from './MediaContentEditor'
import { activeNode, canvasNodeStatusLabels } from './useGenerationCanvasRuntime'

/** Canvas-level records remain accessible even after the editable source card is removed. */
export function RunHistory({ runs, targetRun, targetNode, disabled, onSave, onSelectVideoFrame, onCancel, cancelling, onClose }: {
  runs: CanvasRunRead[]; targetRun?: string | null; targetNode?: string | null; disabled: boolean;
  onSave: (node: CanvasNodeRead, position: number) => Promise<boolean>;
  onSelectVideoFrame: (source: VideoFrameSource) => void;
  onCancel: (runId: string, nodeId?: string) => Promise<void>; cancelling: Set<string>; onClose: () => void;
}) {
  const [open, setOpen] = useState(false), [saving, setSaving] = useState(''), [message, setMessage] = useState(''), [error, setError] = useState('')
  const root = useRef<HTMLElement>(null)
  const close = () => { setOpen(false); onClose() }
  const targetExists = runs.some(run => run.id === targetRun)
  useEffect(() => { if (targetRun) setOpen(true) }, [targetRun])
  useEffect(() => {
    if (!open || !targetRun || !targetExists) return
    const run = root.current?.querySelector<HTMLDetailsElement>(`[data-history-run="${CSS.escape(targetRun)}"]`)
    if (run) {
      run.open = true
      const node = targetNode ? run.querySelector<HTMLElement>(`[data-history-node="${CSS.escape(targetNode)}"]`) : run
      if (node) { node.focus(); node.scrollIntoView({ block: 'nearest' }) }
    }
  }, [open, targetRun, targetNode, targetExists])
  const copy = async (text: string) => {
    try { await navigator.clipboard.writeText(text); setMessage('正文已复制'); setError('') }
    catch { setError('复制失败，可选中正文手动复制') }
  }
  const save = async (node: CanvasNodeRead, position: number) => {
    if (saving || disabled) return
    setSaving(`${node.id}:${position}`); setMessage(''); setError('')
    try { if (await onSave(node, position)) setMessage('已另存为独立内容卡，保留原运行来源') }
    catch { setError('另存失败，当前编辑已保留，请重试') }
    finally { setSaving('') }
  }
  return <>
    <Button aria-expanded={open} onClick={open ? close : () => setOpen(true)}>运行历史</Button>
    <WorkbenchDetails title="运行历史" open={open} onClose={close}><section ref={root} aria-label="画布运行历史" className="generation-run-history">
      {message && <p role="status">{message}</p>}{error && <Alert type="error" message={error} />}
      {!runs.length && <Empty description="尚无运行记录" />}
      {targetRun && !targetExists && <p role="status">正在恢复目标运行记录；若记录不存在，请核实画布来源</p>}
      {[...runs].reverse().map(run => <details key={run.id} data-history-run={run.id} tabIndex={-1}>
        <summary>运行 {run.id} · {run.lifecycle === 'active' ? '活动中' : '已结束'}</summary>
        <Button disabled={disabled || run.lifecycle !== 'active' || cancelling.has(run.id) || run.nodes.filter(activeNode).every(node => node.stage === 'cancelling')} onClick={() => void onCancel(run.id)}>取消本轮运行</Button>
        {run.nodes.map(node => <section key={node.id} data-history-node={node.id} tabIndex={-1} aria-label={`运行节点 ${node.id}`}>
          <strong>卡片 {node.card_id}</strong>
          <p role="status">{node.stage === 'cancelling' ? '取消中，等待任务终态' : canvasNodeStatusLabels[node.status] || node.status}</p>
          <Button disabled={disabled || !activeNode(node) || node.stage === 'cancelling' || cancelling.has(node.id)} onClick={() => void onCancel(run.id, node.id)}>取消此节点</Button>
          <details><summary>本次实际输入与模型参数</summary>
            <section aria-label="历史实际输入"><CanvasTextPreview text={node.basis?.input?.text || ''} label="历史输入" /></section>
            <p>模型：{node.basis?.model?.name || node.basis?.model?.id || '未记录'}</p>
            <pre>{JSON.stringify(node.basis?.model?.params || {}, null, 2)}</pre>
            {node.basis?.input?.video_media && <section aria-label="历史视频用途"><pre>{JSON.stringify(node.basis.input.video_media, null, 2)}</pre></section>}
            {!!node.basis?.input?.mapping?.length && <pre>{JSON.stringify(node.basis.input.mapping, null, 2)}</pre>}
          </details>
          {node.text && <section aria-label="历史累计正文"><CanvasTextPreview text={node.text} label="历史正文" /><Button onClick={() => void copy(node.text)}>复制正文</Button></section>}
          {!activeNode(node) && node.status !== 'succeeded' && <p>未完成成果，未替换原正式输出</p>}
          {!activeNode(node) && node.outputs.map((output, position) => <section key={position} aria-label={`历史成果 ${position + 1}`}>
            <p>{node.status === 'succeeded' ? '完整成果' : '未完成成果'} · 输出 {position + 1}</p>
            {output.text && output.text !== node.text && <CanvasTextPreview text={output.text} label="成果正文" />}
            {output.file_id && <MediaPreview fileId={output.file_id} type={output.modality} />}
            {['text', 'image', 'video'].includes(output.modality) && <Space><Button disabled={disabled || !!saving} loading={saving === `${node.id}:${position}`} onClick={() => void save(node, position)}>另存为{({ text: '文本', image: '图片', video: '视频' } as Record<string, string>)[output.modality]}内容卡</Button>
              {node.status === 'succeeded' && node.result_set_id && output.modality === 'video' && output.file_id && <Button disabled={disabled || !!saving}
                onClick={() => onSelectVideoFrame({ source_card_id: node.card_id, source_file_id: output.file_id!,
                  result: { run_id: run.id, node_id: node.id, position } })}>选帧为图片</Button>}</Space>}
          </section>)}
          {node.error_message && <Alert type="error" message={`${node.error_code || '运行失败'}: ${node.error_message}`} />}
        </section>)}
      </details>)}
    </section></WorkbenchDetails>
  </>
}
