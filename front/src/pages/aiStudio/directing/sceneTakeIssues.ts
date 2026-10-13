import type { MediaRange, SceneTakeJudgment_Output, SceneTakeLibraryRead, SceneVersionContent_Output } from '../../../services/generated'

export function invalidTakeRange(range: MediaRange, duration: number | null) {
  return !Number.isInteger(range.source_in_ms) || !Number.isInteger(range.source_out_ms)
    || range.source_in_ms < 0 || range.source_out_ms <= range.source_in_ms
    || duration == null || range.source_out_ms > duration
}

/** 本地问题用于定位修正，最终文件身份与区间仍由保存接口核验。 */
export function sceneTakeIssues(judgment: SceneTakeJudgment_Output, take: SceneTakeLibraryRead, content: SceneVersionContent_Output) {
  const issues: { label: string; fieldId: string }[] = []
  if (!take.available || judgment.file_id !== take.file_id) issues.push({ label: '原素材文件不可用或身份不一致', fieldId: 'scene-take-judgment' })
  judgment.annotation.retained_ranges.forEach((range, index) => {
    if (invalidTakeRange(range, take.duration_ms)) issues.push({ label: `可用区间 ${index + 1} 无效`, fieldId: `scene-take-range-${index}-out` })
  })
  judgment.annotation.coverage.forEach((row, index) => {
    if (!content.units.some(unit => unit.id === row.unit_id && unit.coverage.some(item => item.id === row.coverage_item_id))) {
      issues.push({ label: `实际覆盖 ${index + 1} 目标已失效`, fieldId: 'scene-take-coverage-editor' })
    } else if (invalidTakeRange(row.media_range, take.duration_ms) || row.source.kind !== 'file' || row.source.file_id !== take.file_id
      || row.source.media_range?.source_in_ms !== row.media_range.source_in_ms || row.source.media_range?.source_out_ms !== row.media_range.source_out_ms) {
      issues.push({ label: `实际覆盖 ${index + 1} 证据区间无效`, fieldId: 'scene-take-coverage-editor' })
    }
  })
  return issues
}
