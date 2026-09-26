import { Button, Progress, Tag, Tooltip } from 'antd'
import { CheckCircleOutlined, EditOutlined } from '@ant-design/icons'
import type { ShotRead } from '../../../../services/generated'

type ReadinessCheckKey = 'characters' | 'scene' | 'props' | 'costumes'

type ReadinessEntry = {
  id: number
  name: string
  status: 'pending' | 'linked' | 'ignored'
}

type ReadinessCheck = {
  key: ReadinessCheckKey
  label: string
  importance: string
  entries: ReadinessEntry[]
  missing: string[]
  expectedCount: number
  actualCount: number
  ignoredCount: number
  resolvedCount: number
  ready: boolean
}

type PromptAssetReadiness = {
  checks: ReadinessCheck[]
  expectedChecks: ReadinessCheck[]
  readyCount: number
  totalCount: number
  percent: number
  hasMissing: boolean
}

type ChapterStudioReadinessDiagnosisPanelProps = {
  selectedShot: ShotRead | null
  shotAssetsOverview: unknown | null
  promptAssetReadiness: PromptAssetReadiness
  promptAssetReadinessNote: string
  shotExtractStatusSource: 'idle'
  shotExtractStatusText: string
  onGoToShotEdit: () => void
  onHandleMissingAction: (kind: ReadinessCheckKey, name: string) => void
  getReadinessExistenceLabel: (kind: ReadinessCheckKey, name: string) => string | null
}

export function ChapterStudioReadinessDiagnosisPanel({
  selectedShot,
  shotAssetsOverview,
  promptAssetReadiness,
  promptAssetReadinessNote,
  shotExtractStatusSource,
  shotExtractStatusText,
  onGoToShotEdit,
  onHandleMissingAction,
  getReadinessExistenceLabel,
}: ChapterStudioReadinessDiagnosisPanelProps) {
  return (
    <div className="cs-group cs-readiness-card">
      <div className="cs-group-title">
        <CheckCircleOutlined /> 信息确认诊断
      </div>
      <div className="cs-readiness-note">{promptAssetReadinessNote}</div>
      {selectedShot ? (
        <div className="mt-3">
          <Button icon={<EditOutlined />} onClick={onGoToShotEdit}>
            去分镜编辑确认
          </Button>
        </div>
      ) : null}
      {shotExtractStatusText ? (
        <div className={`cs-readiness-status is-${shotExtractStatusSource}`}>
          <span>{shotExtractStatusText}</span>
          <Tooltip title="前往分镜编辑页处理提取与确认">
            <Button
              type="text"
              size="small"
              className="cs-readiness-status__refresh"
              icon={<EditOutlined />}
              onClick={onGoToShotEdit}
            />
          </Tooltip>
        </div>
      ) : null}

      {!selectedShot ? (
        <div className="text-xs text-gray-400 mt-3">请先选择一个分镜。</div>
      ) : selectedShot.skip_extraction ? (
        <div className="space-y-4 mt-3">
          <div className="rounded-xl border border-emerald-200 bg-emerald-50 px-4 py-4">
            <div className="text-sm font-medium text-emerald-800">当前分镜已标记为无需提取</div>
            <div className="text-xs text-emerald-700 mt-1">
              系统会直接按“提取确认已完成”处理；如果需要修改这项决定，建议前往分镜编辑页处理。
            </div>
          </div>
        </div>
      ) : !shotAssetsOverview ? (
        <div className="text-xs text-gray-400 mt-3">当前分镜还没有读到资产情况，请前往分镜编辑页处理提取与确认。</div>
      ) : (
        <div className="space-y-4 mt-3">
          <div className="rounded-lg border border-dashed border-slate-200 bg-slate-50 px-3 py-3 text-xs text-slate-500">
            这里主要用于诊断当前镜头为什么还在<span className="font-medium text-slate-700">「待确认」</span>状态。如果需要修改提取结果、忽略待确认项或调整“无需提取”，请前往分镜编辑页处理。
          </div>
          <div className="cs-readiness-summary">
            <div>
              <div className="cs-readiness-summary__title">
                {promptAssetReadiness.hasMissing ? '当前仍有未确认提取项' : '当前镜头的信息确认已完成'}
              </div>
              <div className="cs-readiness-summary__desc">
                已完成 {promptAssetReadiness.readyCount}/{promptAssetReadiness.totalCount || 0} 项关键确认；如需调整，请前往分镜编辑页处理
              </div>
            </div>
            <div className="cs-readiness-summary__progress">
              <Progress
                type="circle"
                size={68}
                percent={promptAssetReadiness.percent}
                strokeColor={promptAssetReadiness.hasMissing ? '#f59e0b' : '#10b981'}
              />
            </div>
          </div>

          <div>
            <Button icon={<EditOutlined />} onClick={onGoToShotEdit}>
              去分镜编辑确认
            </Button>
          </div>

          <div className="cs-readiness-grid">
            {promptAssetReadiness.checks.map((item) => (
              <div key={item.key} className={`cs-readiness-item ${item.ready ? 'is-ready' : 'is-missing'}`}>
                <div className="cs-readiness-item__header">
                  <span className="cs-readiness-item__label">{item.label}</span>
                  <Tag color={item.ready ? 'success' : item.expectedCount === 0 ? 'default' : 'warning'}>
                    {item.expectedCount === 0 ? '无需确认' : item.ready ? '已就绪' : `待处理 ${item.missing.length}`}
                  </Tag>
                </div>
                <div className="cs-readiness-item__meta">
                  提取到 {item.expectedCount} 项，已关联 {item.actualCount} 项，已忽略 {item.ignoredCount} 项
                </div>
                <div className="cs-readiness-item__importance">{item.importance}</div>
                {item.expectedCount > 0 ? (
                  <div className="cs-readiness-item__chips">
                    {item.entries.map((entry) => {
                      const missing = entry.status === 'pending'
                      const ignored = entry.status === 'ignored'
                      const existenceLabel = missing ? getReadinessExistenceLabel(item.key, entry.name) : null
                      return (
                        <span key={entry.id} className="cs-readiness-chip-wrap">
                          <Tag
                            color={missing ? 'orange' : ignored ? 'default' : 'green'}
                            className={missing ? 'cs-readiness-tag-action' : undefined}
                            onClick={missing ? () => onHandleMissingAction(item.key, entry.name) : undefined}
                          >
                            {missing ? `待处理：${entry.name}` : ignored ? `已忽略：${entry.name}` : entry.name}
                          </Tag>
                          {missing && existenceLabel ? (
                            <span className="cs-readiness-chip-meta">{existenceLabel}</span>
                          ) : null}
                        </span>
                      )
                    })}
                  </div>
                ) : (
                  <div className="cs-readiness-item__empty">当前分镜的剧本提取结果里还没有提取到这类资产</div>
                )}
              </div>
            ))}
          </div>
        </div>
      )}
    </div>
  )
}
