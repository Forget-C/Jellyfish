import type { CanvasDocument, CanvasResolvedOutput, OutputIdentity } from '../../../services/generated'
import type { useGraphRules } from './CanvasCatalogContext'
import { sourceKey } from './promptRules'
import { resultScopeIncludes } from './resultConnections'

/** 摘要使用本地连接和已发布输出判断已知失效，不额外请求编译。 */
export function designSummarySourceLabel(
  document: CanvasDocument,
  receiverId: string,
  definitions: ReturnType<typeof useGraphRules>['cardDefinitions'],
  outputs?: Record<string, CanvasResolvedOutput[]>,
) {
  return (identity: OutputIdentity) => {
    const source = identity.canvas_id === document.id && document.cards?.find(card => card.id === identity.card_id)
    if (!source) return '失效来源'
    const definition = definitions[source.type || '']
    const label = ('name' in source && source.name?.trim()) || definition?.title || '已关联来源'
    const connected = document.edges?.some(edge => edge.target_card === receiverId && edge.source_card === identity.card_id
      && edge.source_port === identity.port_id && resultScopeIncludes(edge.result_scope, identity.position))
    const output = outputs?.[source.id]?.find(item => sourceKey(item.source) === sourceKey(identity))
    const model = source.type?.startsWith('model.')
    const missingContent = identity.port_id === 'text' && 'text' in source && !source.text
      || ['image', 'video', 'audio'].includes(identity.port_id) && 'file_id' in source
        && (!source.file_id || 'uploading' in source && source.uploading)
      || identity.port_id === 'image' && 'image_binding' in source && !source.image_binding
    if (!connected || !definition?.outputs.some(port => port.id === identity.port_id) || output?.available === false
      || (model ? !!outputs && !output : identity.position !== 0 || missingContent)) return `${label}（失效来源）`
    return output?.basis_current === false ? `${label}（依据已变）` : label
  }
}
