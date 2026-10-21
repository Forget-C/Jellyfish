import { ExclamationCircleOutlined } from '@ant-design/icons'
import type { DesignCanvasNode, MissingCanvasNode } from '../../../services/generated'

/** 卡面只显示后端快照；当前编辑值继续由详情编辑器管理。 */
export function DirectorGraphSummary({ node }: { node: DesignCanvasNode | MissingCanvasNode }) {
  return <div className="design-compact-summary">
    <div className="design-compact-fields">{node.summary.map(field =>
      <p key={field.field} title={`${field.label}：${field.text}`}><span>{field.label}</span><strong>{field.text}</strong></p>)}</div>
    {node.kind === 'missing' && <p>{node.reason}</p>}
    <div className="design-compact-status"><span title={node.kind === 'design' ? node.scope_reason : node.reason}>{node.kind === 'design' ? node.scope_label : '缺失引用'}</span>
      {!!node.issues.length && <span title={node.issues.map(issue => issue.message).join('；')} aria-label={`待处理 ${node.issues.length} 项`} tabIndex={0}>
        <ExclamationCircleOutlined aria-hidden /> 待处理 {node.issues.length} 项
      </span>}
    </div>
  </div>
}
