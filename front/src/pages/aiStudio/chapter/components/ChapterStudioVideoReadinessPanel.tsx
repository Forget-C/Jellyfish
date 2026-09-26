import { Spin, Tag, Tooltip } from 'antd'
import { VideoCameraAddOutlined } from '@ant-design/icons'
import type { ShotRead, ShotVideoReadinessRead } from '../../../../services/generated'
// 阶段 B ③（审计 §4.3 模式 3 / §5.1 R7-R8）：枚举原值一律过全仓唯一映射表，未登记项整行隐藏
import { REFERENCE_MODE, labelFor, videoReadinessCheckLabel } from '../../components/enumLabels.ts'
// 阶段 B ③（审计 §4.3 模式 6）：后端原文 → 主区中文结论
import { toUserFacingText } from '../../components/userFacingMessage.ts'

type ChapterStudioVideoReadinessPanelProps = {
  selectedShot: ShotRead | null
  videoReadinessLoading: boolean
  videoReadiness: ShotVideoReadinessRead | null
  videoReferenceMode: string
}

export function ChapterStudioVideoReadinessPanel({
  selectedShot,
  videoReadinessLoading,
  videoReadiness,
  videoReferenceMode,
}: ChapterStudioVideoReadinessPanelProps) {
  /**
   * 只保留**已登记**的检查项。
   *
   * 审计 §4.3 模式 3 的口径是「为 `check.key` 建中文映射；**未登记项隐藏整行**
   * 而不是回显原值」—— 运行时旧形态是整排 `未通过 · extraction_ready`，
   * 后端将来新增一个 `_check` 就会把新的英文 code 端上主区。
   */
  const knownChecks = (videoReadiness?.checks ?? []).filter((check) => videoReadinessCheckLabel(check.key) !== null)
  const failedChecks = knownChecks.filter((check) => !check.ok)

  return (
    <div className="cs-group">
      <div className="cs-group-title">
        <VideoCameraAddOutlined /> 视频准备度
      </div>
      <div className="cs-hint">这里优先回答当前镜头能不能生成视频，以及还差哪些前置条件。</div>
      {videoReadinessLoading ? (
        <div className="py-6 text-center">
          <Spin />
        </div>
      ) : !selectedShot ? (
        <div className="text-xs text-gray-400">请先选择一个分镜。</div>
      ) : !videoReadiness ? (
        <div className="rounded-lg border border-dashed border-slate-200 bg-slate-50 px-3 py-3 text-xs text-slate-500">
          暂时无法获取当前镜头的视频准备度，请稍后重试。
        </div>
      ) : (
        <div className="space-y-3">
          <div className="flex items-start justify-between gap-3 rounded-xl border border-slate-200 bg-slate-50 px-4 py-3">
            <div>
              <div className="text-sm font-medium text-slate-900">
                {videoReadiness.ready ? '当前镜头已满足视频生成条件' : '当前镜头还不能直接生成视频'}
              </div>
              <div className="text-xs text-slate-500 mt-1">
                当前按 <Tag className="!mx-1">{labelFor(REFERENCE_MODE, videoReferenceMode)}</Tag> 参考模式检查视频生成条件。
              </div>
            </div>
            <Tag color={videoReadiness.ready ? 'green' : 'gold'}>
              {videoReadiness.ready ? '可生成' : '待补齐'}
            </Tag>
          </div>

          <div className="flex flex-wrap gap-2">
            {knownChecks.map((check) => (
              // title 在**悬停即见**，与正文同一口径：后端原文先过掩码 + 业务化改写
              <Tooltip key={check.key} title={toUserFacingText(check.message, '这一项有需要注意的地方')}>
                <Tag color={check.ok ? 'green' : 'default'}>
                  {check.ok ? '通过' : '未通过'} · {videoReadinessCheckLabel(check.key)}
                </Tag>
              </Tooltip>
            ))}
          </div>

          {failedChecks.length ? (
            <div className="space-y-1">
              {failedChecks.map((check) => (
                <div key={check.key} className="text-xs text-gray-600">
                  • {toUserFacingText(check.message, '这一项有需要注意的地方')}
                </div>
              ))}
            </div>
          ) : null}
        </div>
      )}
    </div>
  )
}
