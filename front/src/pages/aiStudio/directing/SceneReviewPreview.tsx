import { WorkbenchDetails } from './ui/WorkbenchDetails'
import type { SceneTakeLibraryRead, SceneVersionContent_Output } from '../../../services/generated'
import { SceneTimelinePreview } from './SceneTimelinePreview'

/** 只读重看固定审片内容；复用实际播放器，不把历史配置应用到当前编辑。 */
export function SceneReviewPreview({ content, takes, seam, onClose, onStart }: {
  content: SceneVersionContent_Output; takes: SceneTakeLibraryRead[]; seam?: [string, string]; onClose: () => void; onStart: () => void
}) {
  let items = content.timeline.items
  if (seam) {
    const left = items.find(item => item.id === seam[0]), right = items.find(item => item.id === seam[1])
    items = left && right && 'media_range' in left && 'media_range' in right
      ? [{ ...left, timeline_start_ms: 0 }, { ...right, timeline_start_ms: left.media_range.source_out_ms - left.media_range.source_in_ms }] : []
  }
  return <WorkbenchDetails open initialExpanded title={seam ? '历史接缝预览' : '历史整场预览'} status="只读" onClose={onClose}>
    <p>当时输出画幅：{content.output_aspect_ratio}</p>
    <p>按原区间和构图只读播放，不覆盖当前内容，也不自动采用或生成。</p>
    <SceneTimelinePreview scope={seam ? 'seam' : 'scene'} items={items} takes={takes} outputAspectRatio={content.output_aspect_ratio} onStart={onStart} />
  </WorkbenchDetails>
}
