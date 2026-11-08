import { useEffect, useState } from 'react'
import { Popover } from 'antd'
import { InfoCircleOutlined, LinkOutlined } from '@ant-design/icons'
import type { CanvasNodeRead, CanvasResolvedOutput } from '../../../services/generated'
import type { GenerationCard } from './graphRules'
import { canvasNodeStatusLabels } from './useGenerationCanvasRuntime'
import { WorkbenchIconButton } from '../directing/ui/WorkbenchButton'
import './cardStatusSummary.css'

/** 状态只读取本卡的实际采用和运行快照；候选边不计入来源数。 */
export function CardStatusSummary({ card, node, outputs, readonly, missingImage, imageDimensions }: {
  card: GenerationCard; node?: CanvasNodeRead; outputs: CanvasResolvedOutput[]; readonly: boolean; missingImage: boolean; imageDimensions?: string
}) {
  const [explaining, setExplaining] = useState(false)
  useEffect(() => {
    if (!explaining) return
    const close = (event: KeyboardEvent) => { if (event.key === 'Escape') { event.preventDefault(); event.stopPropagation(); setExplaining(false) } }
    window.addEventListener('keydown', close, true)
    return () => window.removeEventListener('keydown', close, true)
  }, [explaining])
  const model = 'model_id' in card
  const stale = outputs.some(output => output.basis_current === false)
  const retained = outputs.length > 0 && !!node && node.status !== 'succeeded'
  const changed = node?.status === 'succeeded' && !node.current_output_updated
  const reasons = [node?.error_message, stale && '依据已变，旧正式输出仍保留', changed && '配置已变，本次结果未替换正式输出'].filter(Boolean)
  const config = 'config' in card ? card.config : undefined
  const specification = [config && 'target_ratio' in config && config.target_ratio, config && 'resolution_profile' in config && config.resolution_profile].filter(value => typeof value === 'string' && value).join(' · ')
  return <section className="generation-card-status" aria-label={model ? '模型状态摘要' : '卡片状态摘要'}>
    {model && <span data-problem={node?.status === 'failed' || stale || changed || undefined}>{canvasNodeStatusLabels[node?.status || ''] || '尚未运行'}</span>}
    {card.type === 'content.image' && <><span>图片</span>{imageDimensions && <span>{imageDimensions}</span>}</>}
    {readonly && <span>只读</span>}
    {model && <span className="generation-card-adopted"><LinkOutlined aria-hidden /> 已采用 {card.input_bindings?.length || 0}</span>}
    {retained && <span>保留上次成果</span>}
    {stale && <span data-problem>依据已变</span>}
    {changed && <span data-problem>本次结果仅入历史</span>}
    {missingImage && <span data-problem>缺少主图</span>}
    {'uploading' in card && card.uploading && <span>上传尚未完成</span>}
    {'text' in card && <span>{card.text?.length || 0} 字</span>}
    {'source_locator' in card && card.type === 'content.basis' && card.source_locator && <span className="generation-card-specification" title={card.source_locator}>{card.source_locator}</span>}
    {specification && <span className="generation-card-specification" title={specification}>{specification}</span>}
    {reasons.length > 0 && <Popover trigger="click" open={explaining} onOpenChange={setExplaining} title="状态说明" content={<div className="generation-card-status-reasons">{reasons.map((reason, index) => <p key={index}>{reason}</p>)}</div>}>
      <WorkbenchIconButton label="查看状态说明" icon={<InfoCircleOutlined />} variant="quiet" />
    </Popover>}
  </section>
}
