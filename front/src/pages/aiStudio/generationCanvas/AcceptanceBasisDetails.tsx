import { useUiText } from '../../../uiText'
import { ConfigProvider } from 'antd'
import type { AcceptanceCriterionCard, CanvasDocument } from '../../../services/generated'
import { WorkbenchButton } from '../../../components/workbench/WorkbenchButton'
import { CanvasTextPreview } from '../../../components/workbench/CanvasTextPreview'
import { DesignMetadataLine } from './DesignMetadataLine'
import { designFieldMetadataParts } from './designFieldMetadata'
import { designPhaseLabel } from './designScope'
import './acceptanceBasis.css'

/** 验收来源的只读标准与解除入口，放入公共来源详情浮层。 */
export function AcceptanceBasisDetails({ current, receiverId, document, disabled, onDisconnect, onLocateDesign, onClose }: {
  current: AcceptanceCriterionCard; receiverId: string; document: CanvasDocument; disabled?: boolean;
  onDisconnect?: (id: string) => void; onLocateDesign?: (cardId: string, fieldId: string) => void; onClose?: (restore?: boolean) => void;
}) {
  const uiText = useUiText()
  const text = current.standard?.document ? current.standard.document.segments?.map(part => part.kind === 'text' ? part.text : '@' + (() => { const source = document.cards?.find(source => source.id === part.source.card_id); return source && 'name' in source && source.name || part.source.card_id })()).join('') : current.standard?.text
  const metadata = designFieldMetadataParts(current.standard, { purpose: 'constraint' })
  const edge = document.edges?.find(item => item.source_card === current.id && item.target_card === receiverId && item.target_port === 'acceptance_basis')
  return <section className="acceptance-detail" aria-label={uiText("验收要求详情")}><h4>{current.name || uiText("未命名验收要求")}</h4><strong>{uiText("可观察判断标准")}</strong><CanvasTextPreview text={text || uiText("标准尚未填写")} label={uiText("验收标准")} />
        <DesignMetadataLine items={metadata} />
        {current.scope?.description && <p>{uiText("内容适用范围：")}{current.scope.description}</p>}
        {current.scope?.phase && <p>{uiText("制作阶段：")}{designPhaseLabel(current.scope.phase)}</p>}
        {current.scope?.condition && <p>{uiText("适用条件：")}{current.scope.condition}</p>}
        {current.source_locator?.trim() && <DesignMetadataLine items={[{ label: uiText("卡片原始来源"), text: current.source_locator }]} />}
        <div className="acceptance-actions"><ConfigProvider componentDisabled={false}><WorkbenchButton variant="quiet" disabled={!onLocateDesign} onClick={() => { onClose?.(false); onLocateDesign?.(current.id, 'standard') }}>{uiText("定位源卡")}</WorkbenchButton></ConfigProvider><WorkbenchButton variant="quiet" disabled={disabled || !edge || !onDisconnect} onClick={() => { if (edge) { onDisconnect?.(edge.id); onClose?.() } }}>{uiText("解除关联")}</WorkbenchButton></div>
      </section>
}
